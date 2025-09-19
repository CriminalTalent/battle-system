// ─────────────────────────────────────────
// 외부 엔진 자동 로드 (있으면 우선 사용)  ⟵ 이 블록만 교체
// ─────────────────────────────────────────
async function tryLoadExternalEngine(io) {
  const candidate = path.join(__dirname, 'src/engine/BattleEngine.js');
  try {
    await fs.promises.access(candidate, fs.constants.R_OK);
  } catch {
    return null;
  }

  try {
    const mod = await import(pathToFileURL(candidate).href);
    if (typeof mod.createBattleStore !== 'function') return null;

    // 외부 엔진 인스턴스 생성(가능하면 io/ctx 주입)
    const ext = mod.createBattleStore(io) || mod.createBattleStore({ io }) || mod.createBattleStore();

    const bind = (name) => (typeof ext?.[name] === 'function' ? ext[name].bind(ext) : null);
    const pick = (...names) => {
      for (const n of names) {
        const fn = bind(n);
        if (fn) return fn;
      }
      return null;
    };

    // 다형 호출 도우미
    const tryMany = async (fn, variants) => {
      let lastErr;
      for (const makeArgs of variants) {
        try {
          const ret = fn(...makeArgs());
          return ret instanceof Promise ? await ret : ret;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('No matching signature');
    };

    // 원 함수들
    const _create  = pick('createBattle', 'create');
    const _add     = pick('addPlayer', 'addPlayerToBattle');
    const _remove  = pick('deletePlayer', 'removePlayer');
    const _ready   = pick('setReady', 'readyPlayer', 'playerReady');
    const _start   = pick('start', 'startBattle');
    const _pause   = pick('pause', 'pauseBattle');
    const _resume  = pick('resume', 'resumeBattle');
    const _end     = pick('end', 'endBattle');
    const _act     = pick('act', 'applyAction', 'resolveAction');

    const adapter = {
      battles: ext.battles || ext.store || new Map(),

      // createBattle: "mode" | {mode} | ... 지원
      async createBattle(mode = '2v2') {
        if (!_create) throw new Error('createBattle not found');
        return await tryMany(_create, [
          () => [mode],
          () => [{ mode }],
          () => [{ params: { mode } }],
        ]);
      },

      // addPlayer: (battleId, player) | ({battleId, player}) | JSON 문자열 등 지원
      async addPlayer(battleId, player) {
        if (!_add) throw new Error('addPlayer not found');
        const playerJson = JSON.stringify(player);
        return await tryMany(_add, [
          () => [battleId, player],                         // (id, obj)
          () => [{ battleId, player }],                     // ({})
          () => [battleId, playerJson],                     // (id, JSON)
          () => [{ battleId, player: playerJson }],         // ({ JSON })
        ]);
      },

      async deletePlayer(battleId, playerId) {
        if (!_remove) throw new Error('deletePlayer not found');
        return await tryMany(_remove, [
          () => [battleId, playerId],
          () => [{ battleId, playerId }],
        ]);
      },

      async setReady(battleId, playerId) {
        if (!_ready) throw new Error('setReady not found');
        return await tryMany(_ready, [
          () => [battleId, playerId],
          () => [{ battleId, playerId }],
        ]);
      },

      async start(battleId) {
        if (!_start) throw new Error('start not found');
        return await tryMany(_start, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async pause(battleId) {
        if (!_pause) throw new Error('pause not found');
        return await tryMany(_pause, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async resume(battleId) {
        if (!_resume) throw new Error('resume not found');
        return await tryMany(_resume, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async end(battleId, winner = null) {
        if (!_end) throw new Error('end not found');
        return await tryMany(_end, [
          () => [battleId, winner],
          () => [{ battleId, winner }],
        ]);
      },

      async act(battleId, playerId, action) {
        if (!_act) throw new Error('act not found');
        const actionJson = JSON.stringify(action || { type: 'pass' });
        return await tryMany(_act, [
          () => [battleId, playerId, action],                  // (id, pid, obj)
          () => [{ battleId, playerId, action }],              // ({})
          () => [battleId, playerId, actionJson],              // (id, pid, JSON)
          () => [{ battleId, playerId, action: actionJson }],  // ({ JSON })
        ]);
      },

      // 외부 엔진이 제공하면 사용, 아니면 서버 기본 구현 사용
      makeLinks: ext.makeLinks ? ext.makeLinks.bind(ext) : null,
      authByToken: ext.authByToken ? ext.authByToken.bind(ext) : null,

      __ext: ext
    };

    console.log('[ENGINE] External BattleEngine.js 로드됨 (adapter: multi-signature enabled)');
    return adapter;
  } catch (e) {
    console.log('[ENGINE] External 로드 실패:', e.message);
    return null;
  }
}
