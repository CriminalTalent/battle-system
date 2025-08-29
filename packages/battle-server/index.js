/**
 * PYXIS Battle Server (admin/player/spectator)
 */
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const BattleEngine = require('./src/services/BattleEngine');

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const allowOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (allowOrigins.includes('*')) return cb(null, true);
    if (!origin) return cb(null, true);
    cb(null, allowOrigins.includes(origin));
  },
  credentials: true
}));

app.use((req,_res,next)=>{ console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });

const engine = new BattleEngine();

function baseUrlFrom(req){
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}
function ok(res, json){ res.status(200).json(Object.assign({ ok:true }, json||{})); }
function bad(res, code, msg){ res.status(code||400).json({ ok:false, message:String(msg||'error') }); }
function requireBattle(id){
  const b = engine.getBattle(id);
  if (!b){ const e=new Error('전투 없음'); e.code=404; throw e; }
  return b;
}

/* --------- API --------- */

// 상태 조회 (관리자 화면 초기 동기화용)
app.get('/api/battles/:id', (req,res)=>{
  try{
    const id = String(req.params.id||'');
    requireBattle(id);
    ok(res, { state: engine.getPublicState(id) });
  }catch(e){ bad(res, e.code||400, e.message); }
});

// 전투 생성
app.post('/api/admin/battles', (req,res)=>{
  try{
    const mode = String(req.body?.mode || '1v1');
    const b = engine.createBattle(mode);
    const base = baseUrlFrom(req);

    const adminUrl = new URL(base);
    adminUrl.pathname = '/admin';
    adminUrl.searchParams.set('battle', b.id);
    adminUrl.searchParams.set('token', b.otp.admin);

    const watchUrl = new URL(base);
    watchUrl.pathname = '/watch';
    watchUrl.searchParams.set('battle', b.id);
    watchUrl.searchParams.set('token', b.otp.spectator.value);
    watchUrl.searchParams.set('name', '관전자');

    ok(res, {
      battle: engine.getPublicState(b.id),
      otps: { admin: b.otp.admin, spectator: b.otp.spectator.value },
      urls: { admin: adminUrl.toString(), watch: watchUrl.toString() },
    });
  }catch(e){ bad(res, 400, e.message); }
});

// 플레이어 추가
app.post('/api/battles/:id/players', (req,res)=>{
  try{
    const id = String(req.params.id||'');
    requireBattle(id);
    const r = engine.addPlayer(id, {
      name: req.body?.name,
      team: req.body?.team,
      stats: req.body?.stats,
      inventory: req.body?.inventory
    });
    ok(res, r);
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id)); // 즉시 반영
  }catch(e){ bad(res, e.code||400, e.message); }
});

// 플레이어 삭제
app.delete('/api/battles/:id/players/:pid', (req,res)=>{
  try{
    const id = String(req.params.id||'');
    const pid = String(req.params.pid||'');
    requireBattle(id);
    ok(res, engine.removePlayer(id, pid));
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
  }catch(e){ bad(res, e.code||400, e.message); }
});

// 플레이어별 링크 생성
app.post('/api/admin/battles/:id/links', (req,res)=>{
  try{
    const id = String(req.params.id||'');
    requireBattle(id);
    const base = baseUrlFrom(req);
    const r = engine.generatePlayerLinks(id, base);
    ok(res, r);
  }catch(e){ bad(res, e.code||400, e.message); }
});

// 제어
app.post('/api/admin/battles/:id/start', (req,res)=>{
  try{ const id=String(req.params.id||''); requireBattle(id);
    ok(res, engine.startBattle(id));
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
  }catch(e){ bad(res, e.code||400, e.message); }
});
app.post('/api/admin/battles/:id/pause', (req,res)=>{
  try{ const id=String(req.params.id||''); requireBattle(id);
    ok(res, engine.pauseBattle(id));
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
  }catch(e){ bad(res, e.code||400, e.message); }
});
app.post('/api/admin/battles/:id/end', (req,res)=>{
  try{ const id=String(req.params.id||''); requireBattle(id);
    ok(res, engine.endBattle(id));
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
  }catch(e){ bad(res, e.code||400, e.message); }
});

// 아바타 업로드(2MB)
app.post('/api/battles/:id/avatar', (req,res)=>{
  try{
    const id = String(req.params.id||'');
    const pid = String(req.body?.pid||'');
    const dataUrl = String(req.body?.dataUrl||'');
    requireBattle(id);
    ok(res, engine.setPlayerAvatar(id, pid, dataUrl));
    io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
  }catch(e){ bad(res, e.code||400, e.message); }
});

/* --------- Static --------- */
const pubRoot = path.join(__dirname, 'public');
app.use(express.static(pubRoot, { index:false }));
app.get('/', (_req,res)=>res.redirect('/admin'));
app.get('/admin', (_req,res)=>res.sendFile(path.join(pubRoot,'admin.html')));
app.get('/admin.html', (_req,res)=>res.sendFile(path.join(pubRoot,'admin.html')));
app.get('/play', (_req,res)=>res.sendFile(path.join(pubRoot,'play.html')));
app.get('/play.html', (_req,res)=>res.sendFile(path.join(pubRoot,'play.html')));
app.get('/watch', (_req,res)=>res.sendFile(path.join(pubRoot,'watch.html')));
app.get('/watch.html', (_req,res)=>res.sendFile(path.join(pubRoot,'watch.html')));

/* --------- Socket.IO --------- */
const httpServer = http.createServer(app);
const io = new Server(httpServer, { path:'/socket.io/', cors:{ origin: allowOrigins.includes('*') ? true : allowOrigins, credentials:true } });

io.on('connection', (socket)=>{
  socket.role='guest'; socket.battleId=null; socket.pid=null;

  socket.on('auth', (payload, cb)=>{
    try{
      const role = String(payload?.role||'');
      const id   = String(payload?.battle||'');
      const tok  = String(payload?.token||'');
      const name = String(payload?.name||'');
      requireBattle(id);

      if (role==='admin'){
        const r = engine.adminAuth(id, tok);
        if (!r.ok) return cb && cb({ ok:false, error:r.message||'인증 실패' });
        socket.role='admin'; socket.battleId=id; socket.join(`battle:${id}`);
        return cb && cb({ ok:true, state:r.state });
      }
      if (role==='spectator'){
        const r = engine.spectatorAuth(id, tok, name);
        if (!r.ok) return cb && cb({ ok:false, error:r.message||'인증 실패' });
        socket.role='spectator'; socket.battleId=id; socket.join(`battle:${id}`);
        return cb && cb({ ok:true, state:r.state });
      }
      if (role==='player'){
        const r = engine.playerAuthByName(id, tok, name);
        if (!r.ok) return cb && cb({ ok:false, error:r.message||'인증 실패' });
        socket.role='player'; socket.battleId=id; socket.pid=r.selfPid||null; socket.join(`battle:${id}`);
        return cb && cb({ ok:true, state:r.state, selfPid:r.selfPid||null });
      }
      return cb && cb({ ok:false, error:'역할 불명' });
    }catch(e){ return cb && cb({ ok:false, error:e.message||'인증 실패' }); }
  });

  socket.on('chatMessage', (data, cb)=>{
    try{
      if (!socket.battleId) throw new Error('인증되지 않음');
      if (socket.role==='spectator') throw new Error('관전자는 채팅 불가');
      const channel = data?.channel==='team' ? 'team' : 'all';
      const text = String(data?.message||'').trim();
      if (!text) throw new Error('메시지 없음');
      engine.pushChat(socket.battleId, { type:'chat', from: socket.role==='admin'?'관리자':'플레이어', channel, text });
      io.to(`battle:${socket.battleId}`).emit('chat', { type:'chat', from: socket.role==='admin'?'관리자':'플레이어', channel, text, ts: Date.now() });
      cb && cb({ ok:true });
    }catch(e){ socket.emit('chatError', e.message||'채팅 오류'); cb && cb({ ok:false, error:e.message }); }
  });

  socket.on('cheer', (data, cb)=>{
    try{
      if (!socket.battleId) throw new Error('인증되지 않음');
      const text = String(data?.text||'').trim();
      if (!text) throw new Error('메시지 없음');
      engine.pushChat(socket.battleId, { type:'cheer', from:'관전자', text });
      io.to(`battle:${socket.battleId}`).emit('chat', { type:'cheer', from:'관전자', text, ts: Date.now() });
      cb && cb({ ok:true });
    }catch(e){ cb && cb({ ok:false, error:e.message }); }
  });

  socket.on('playerAction', (data, cb)=>{
    try{
      if (!socket.battleId || socket.role!=='player') throw new Error('플레이어 인증 필요');
      const id = socket.battleId;
      const pid = socket.pid;
      const r = engine.playerAction(id, pid, data||{});
      io.to(`battle:${id}`).emit('state', engine.getPublicState(id));
      cb && cb({ ok:true, state:r.state });
    }catch(e){ cb && cb({ ok:false, error:e.message }); }
  });
});

httpServer.listen(PORT, HOST, ()=>{
  console.log(`Battle server on http://${HOST}:${PORT}`);
  console.log(`Static root: ${pubRoot}`);
  console.log(`Access pages: /admin  /play  /watch`);
});
