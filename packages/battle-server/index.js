// packages/battle-server/index.js
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import multer from 'multer';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────
// 정적 파일
// ──────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

app.get('/',        (_req,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.get('/admin',   (_req,res)=>res.sendFile(path.join(PUBLIC_DIR,'admin.html')));
app.get('/player',  (_req,res)=>res.sendFile(path.join(PUBLIC_DIR,'player.html')));
app.get('/spectator',(_req,res)=>res.sendFile(path.join(PUBLIC_DIR,'spectator.html')));
app.get('/api/health',(_req,res)=>res.json({ ok:true, ts:Date.now(), pid:process.pid }));

// ──────────────────────────────────────
const uploadDir = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req,_f,cb)=>cb(null, uploadDir),
  filename: (_req, f, cb)=>{
    const ext = path.extname(f.originalname||'') || '.png';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage });
app.post('/api/upload/avatar', upload.single('avatar'), (req,res)=>{
  try {
    if(!req.file) return res.status(400).json({ ok:false, error:'NO_FILE' });
    return res.json({ ok:true, url:`/uploads/${req.file.filename}` });
  } catch(e) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

// ──────────────────────────────────────
// 외부 엔진 어댑터
// ──────────────────────────────────────
const pick = (fn)=> typeof fn === 'function' ? fn : null;
const id8 = ()=> Math.random().toString(36).slice(2,10).toUpperCase();

// 관리자 화면이 항상 보이도록 보조 미러
const mirror = new Map(); // battleId -> { id, status, mode, players: [...] }
const ensureMirror = (battleId, base={})=>{
  if(!mirror.has(battleId)) mirror.set(battleId, { id:battleId, status:'waiting', mode:'2v2', players:[], logs:[], ...base });
  return mirror.get(battleId);
};
const upsertMirrorPlayer = (battleId, player)=>{
  const m = ensureMirror(battleId);
  const idx = m.players.findIndex(p=>p.id===player.id);
  if(idx>=0) m.players[idx] = { ...m.players[idx], ...player };
  else m.players.push(player);
};

async function tryLoadExternalEngine(ioInstance){
  const candidate = path.join(__dirname, 'src/engine/BattleEngine.js');
  try { await fs.promises.access(candidate, fs.constants.R_OK); } catch { return null; }

  try {
    const mod = await import(pathToFileURL(candidate).href);
    if (typeof mod.createBattleStore !== 'function') return null;

    const ext = mod.createBattleStore(ioInstance) ||
                mod.createBattleStore({ io: ioInstance }) ||
                mod.createBattleStore();

    const bind = (name) => pick(ext?.[name]) ? ext[name].bind(ext) : null;
    const _create = bind('createBattle') || bind('create');
    const _add    = bind('addPlayer') || bind('addPlayerToBattle');
    const _del    = bind('deletePlayer') || bind('removePlayer');
    const _ready  = bind('setReady') || bind('readyPlayer') || bind('playerReady');
    const _start  = bind('start') || bind('startBattle');
    const _pause  = bind('pause') || bind('pauseBattle');
    const _resume = bind('resume') || bind('resumeBattle');
    const _end    = bind('end') || bind('endBattle');
    const _act    = bind('act') || bind('applyAction') || bind('resolveAction');

    const adapter = {
      battles: ext.battles || ext.store || null,

      async snapshot(battleId){
        if (pick(ext.getSnapshot))  return await ext.getSnapshot(battleId);
        if (pick(ext.getBattle))    return await ext.getBattle(battleId);
        if (this.battles?.get)      return this.battles.get(battleId);
        return null;
      },

      async createBattle(mode='2v2'){
        const ret = await (_create?.(mode) ?? _create?.({mode}) ?? _create?.({params:{mode}}));
        // 엔진이 id만 주는 경우도 처리
        if (typeof ret === 'string') return { id: ret, mode, status:'waiting', players:[] };
        if (ret?.id) return ret;
        const id = id8();
        return { id, mode, status:'waiting', players:[] };
      },

      async addPlayer(battleId, player){
        const body = player && typeof player === 'object' ? player : {};
        await (_add?.(battleId, body) ?? _add?.({ battleId, player: body }));
        return { ok:true };
      },
      async deletePlayer(battleId, playerId){
        await (_del?.(battleId, playerId) ?? _del?.({ battleId, playerId }));
        return { ok:true };
      },
      async setReady(battleId, playerId){
        await (_ready?.(battleId, playerId) ?? _ready?.({ battleId, playerId }));
        return { ok:true };
      },
      async start(battleId){ await (_start?.(battleId) ?? _start?.({ battleId })); return { ok:true }; },
      async pause(battleId){ await (_pause?.(battleId) ?? _pause?.({ battleId })); return { ok:true }; },
      async resume(battleId){ await (_resume?.(battleId) ?? _resume?.({ battleId })); return { ok:true }; },
      async end(battleId){ await (_end?.(battleId) ?? _end?.({ battleId })); return { ok:true }; },
      async act(battleId, playerId, action){
        await (_act?.(battleId, playerId, action) ?? _act?.({ battleId, playerId, action }));
        return { ok:true };
      },
      __ext: ext
    };

    console.log('[ENGINE] External BattleEngine.js loaded');
    return adapter;
  } catch(e){
    console.log('[ENGINE] External load failed:', e.message);
    return null;
  }
}

function createFallbackEngine(){
  const store = new Map();
  return {
    async snapshot(id){ return store.get(id)||null; },
    async createBattle(mode='2v2'){
      const id = id8();
      const battle = { id, mode, status:'waiting', players:[], logs:[], createdAt:Date.now() };
      store.set(id, battle);
      return battle;
    },
    async addPlayer(battleId, player){
      const b = store.get(battleId); if(!b) throw new Error('BATTLE_NOT_FOUND');
      b.players.push({
        id: id8(),
        team: player.team||'A',
        name: player.name||'플레이어',
        hp: player.hp ?? 100, maxHp: player.maxHp ?? player.hp ?? 100,
        stats: player.stats||{attack:1,defense:1,agility:1,luck:1},
        items: player.items||{dittany:0,attackBooster:0,defenseBooster:0},
        avatar: player.avatar||''
      });
      return { ok:true };
    },
    async deletePlayer(battleId, playerId){
      const b = store.get(battleId); if(!b) throw new Error('BATTLE_NOT_FOUND');
      b.players = b.players.filter(p=>p.id!==playerId); return { ok:true };
    },
    async setReady(){ return { ok:true }; },
    async start(id){ const b=store.get(id); if(b) b.status='active'; return { ok:true }; },
    async pause(id){ const b=store.get(id); if(b) b.status='paused'; return { ok:true }; },
    async resume(id){ const b=store.get(id); if(b) b.status='active'; return { ok:true }; },
    async end(id){ const b=store.get(id); if(b) b.status='ended'; return { ok:true }; },
    async act(){ return { ok:true }; }
  };
}

let engine = await tryLoadExternalEngine(io);
if(!engine){ console.log('[ENGINE] Fallback engine in use'); engine = createFallbackEngine(); }

// ──────────────────────────────────────
// 링크 생성
// ──────────────────────────────────────
const absBase = (req)=>{
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
};
app.get('/api/link/participant', (req,res)=>{
  const { battleId, id } = req.query;
  if(!battleId) return res.status(400).json({ ok:false, error:'MISSING_battleId' });
  const url = `${absBase(req)}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id||battleId)}`;
  res.json({ ok:true, url, battleId, role:'player' });
});
app.get('/api/link/spectator', (req,res)=>{
  const { battleId, id } = req.query;
  if(!battleId) return res.status(400).json({ ok:false, error:'MISSING_battleId' });
  const url = `${absBase(req)}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id||battleId)}`;
  res.json({ ok:true, url, battleId, role:'spectator' });
});
app.post('/api/admin/battles/:battleId/links', async (req,res)=>{
  try{
    const { battleId } = req.params;
    let snap = await engine.snapshot?.(battleId);
    if(!snap) snap = mirror.get(battleId);
    const players = Array.isArray(snap?.players) ? snap.players : [];
    const spectator = { url: `${absBase(req)}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(battleId)}` };
    const playerLinks = players.map(p=>({
      team: p.team, playerId: p.id, playerName: p.name,
      url: `${absBase(req)}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(p.id)}`
    }));
    res.json({ ok:true, links: { spectator, players: playerLinks } });
  }catch(e){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// ──────────────────────────────────────
// 스냅샷 브로드캐스트(엔진 실패 시 미러 사용)
// ──────────────────────────────────────
const normSnap = (snap, fallback)=>{
  if (snap && typeof snap === 'object') {
    const id = snap.id || fallback?.id;
    const status = snap.status || fallback?.status || 'waiting';
    const mode = snap.mode || fallback?.mode || '2v2';
    const players = Array.isArray(snap.players) ? snap.players : [];
    return { id, status, mode, players };
  }
  return fallback;
};
const emitSnapshot = async (battleId)=>{
  let snap = await engine.snapshot?.(battleId);
  const m = ensureMirror(battleId);
  if (!snap) snap = m;
  io.to(battleId).emit('battle:update', normSnap(snap, m));
};

// ──────────────────────────────────────
// Socket.IO
// ──────────────────────────────────────
io.on('connection', (socket)=>{
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('disconnect', ()=>console.log('[Socket] 연결 해제:', socket.id));

  socket.on('join', async ({ battleId })=>{
    if(!battleId) return;
    socket.join(battleId);
    await emitSnapshot(battleId);
  });

  socket.on('createBattle', async ({ mode }, cb)=>{
    try{
      const battle = await engine.createBattle(mode||'2v2');
      const battleId = battle?.id || id8();
      ensureMirror(battleId, { mode: battle?.mode||mode||'2v2', status: battle?.status||'waiting' });
      cb?.({ ok:true, battleId, battle: normSnap(battle, mirror.get(battleId)) });
      await emitSnapshot(battleId);
    }catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('addPlayer', async ({ battleId, player }, cb)=>{
    try{
      await engine.addPlayer(battleId, player);
      // 엔진 스냅샷이 없으면 미러 즉시 반영
      const m = ensureMirror(battleId);
      // id가 없으면 화면 반영용 임시 id라도 부여
      const pid = player.id || id8();
      upsertMirrorPlayer(battleId, {
        id: pid,
        team: player.team || 'A',
        name: player.name || '플레이어',
        hp: player.hp ?? 100, maxHp: player.maxHp ?? player.hp ?? 100,
        stats: player.stats || { attack:1, defense:1, agility:1, luck:1 },
        items: player.items || { dittany:0, attackBooster:0, defenseBooster:0 },
        avatar: player.avatar || ''
      });
      await emitSnapshot(battleId);
      cb?.({ ok:true });
    }catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('deletePlayer', async ({ battleId, playerId }, cb)=>{
    try{
      await engine.deletePlayer(battleId, playerId);
      const m = ensureMirror(battleId);
      m.players = m.players.filter(p=>p.id!==playerId);
      await emitSnapshot(battleId);
      cb?.({ ok:true });
    }catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('setReady', async ({ battleId, playerId }, cb)=>{
    try{ await engine.setReady(battleId, playerId); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('startBattle', async ({ battleId }, cb)=>{
    try{ ensureMirror(battleId).status='active'; await engine.start(battleId); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });
  socket.on('pauseBattle', async ({ battleId }, cb)=>{
    try{ ensureMirror(battleId).status='paused'; await engine.pause(battleId); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });
  socket.on('resumeBattle', async ({ battleId }, cb)=>{
    try{ ensureMirror(battleId).status='active'; await engine.resume(battleId); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });
  socket.on('endBattle', async ({ battleId }, cb)=>{
    try{ ensureMirror(battleId).status='ended'; await engine.end(battleId); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('act', async ({ battleId, playerId, action }, cb)=>{
    try{ await engine.act(battleId, playerId, action); await emitSnapshot(battleId); cb?.({ ok:true }); }
    catch(e){ cb?.({ ok:false, error:String(e?.message||e) }); }
  });

  socket.on('chatMessage', ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { name: name||'관리자', message, ts: Date.now() });
  });
});

// 마지막 에러 핸들러
app.use((err,_req,res,_next)=>{ console.error('[HTTP ERROR]', err); res.status(500).send('Server error'); });

// 부팅
const PORT = process.env.PORT || 3001;
server.listen(PORT,'0.0.0.0',()=>console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`));
