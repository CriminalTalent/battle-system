// packages/battle-server/src/socket/battleSocket.js
const {
  validatePlayerOTP,
  validateAdminOTP,
  validateSpectatorOTP,
} = require('../logic/battleAccess');

const {
  getBattleById,
  getBattleForBroadcast,
} = require('../logic/battleStore');

const { saveChatMessage } = require('../logic/chatLogic');

// 선택적: 액션 엔진이 있는 프로젝트면 자동 연동
let executeAction = null;
try {
  ({ executeAction } = require('../logic/battleActions')); // optional
} catch (_) { /* noop - optional */ }

module.exports = function (io) {
  io.on('connection', (socket) => {
    // 연결 상태
    socket.auth = {
      battleId: null,
      role: null,        // 'admin' | 'player' | 'spectator'
      playerId: null,
      spectatorName: null,
      teamKey: null,     // 'team1' | 'team2' (플레이어 인증 후 세팅)
    };

    // ───────────────────────── 유틸/룸 ─────────────────────────
    const ROOM = (battleId, tag) => `${battleId}-${tag}`;
    const TEAM_ROOM = (battleId, teamKey) => `${battleId}-${teamKey}`;

    const ALLOWED_CHEERS = new Set([
      '힘내라!','멋지다!','이길 수 있어!','포기하지마!',
      '힘내!','지지마!','포기하지 마!','화이팅!','대박!',
    ]);

    const sanitize = (s) => String(s ?? '').slice(0, 500);

    const getPlayerTeamKey = (battle, playerId) => {
      if (!battle) return null;
      if (battle?.teams?.team1?.players?.some(p => p.id === playerId)) return 'team1';
      if (battle?.teams?.team2?.players?.some(p => p.id === playerId)) return 'team2';
      return null;
    };

    const broadcastState = async (battleId) => {
      if (!battleId) return;
      const state = await getBattleForBroadcast(battleId);
      // 프런트 호환: battleUpdate (플레이어/관전자/관리자 모두 수신)
      io.to(ROOM(battleId, 'admin')).emit('battleUpdate', state);
      io.to(ROOM(battleId, 'player')).emit('battleUpdate', state);
      io.to(ROOM(battleId, 'spectator')).emit('battleUpdate', state);
      // 팀 룸에도 동일 송신(팀 카드만 따로 듣는 클라 대응)
      io.to(TEAM_ROOM(battleId, 'team1')).emit('battleUpdate', state);
      io.to(TEAM_ROOM(battleId, 'team2')).emit('battleUpdate', state);
    };

    // 팀 채팅/전체 채팅 실시간 이벤트 브로드캐스트
    const fanoutChat = (battleId, payload, { teamOnly = false, teamKey = null } = {}) => {
      const messageEvtLegacy = 'chat-message'; // 기존 코드 호환
      const messageEvtNew    = 'chat';         // 새 UI 호환

      if (teamOnly && teamKey) {
        // 팀 전용: 해당 팀 룸 + 관리자 룸 (관전자에게는 비공개)
        io.to(TEAM_ROOM(battleId, teamKey)).emit(messageEvtNew, payload);
        io.to(ROOM(battleId, 'admin')).emit(messageEvtNew, payload);
        io.to(TEAM_ROOM(battleId, teamKey)).emit(messageEvtLegacy, { message: payload });
        io.to(ROOM(battleId, 'admin')).emit(messageEvtLegacy, { message: payload });
      } else {
        // 전체 공개
        io.to(ROOM(battleId, 'admin')).emit(messageEvtNew, payload);
        io.to(ROOM(battleId, 'player')).emit(messageEvtNew, payload);
        io.to(ROOM(battleId, 'spectator')).emit(messageEvtNew, payload);

        io.to(ROOM(battleId, 'admin')).emit(messageEvtLegacy, { message: payload });
        io.to(ROOM(battleId, 'player')).emit(messageEvtLegacy, { message: payload });
        io.to(ROOM(battleId, 'spectator')).emit(messageEvtLegacy, { message: payload });
      }
    };

    const joinRoleRooms = async (role, battleId, playerId = null) => {
      socket.join(ROOM(battleId, role));
      // 플레이어: 팀 룸 조인
      if (role === 'player' && playerId) {
        const battle = await getBattleById(battleId);
        const teamKey = getPlayerTeamKey(battle, playerId);
        if (teamKey) {
          socket.join(TEAM_ROOM(battleId, teamKey));
          socket.auth.teamKey = teamKey;
        }
      }
      // 관리자: 양 팀 룸 모두 조인(팀 채팅 열람)
      if (role === 'admin') {
        socket.join(TEAM_ROOM(battleId, 'team1'));
        socket.join(TEAM_ROOM(battleId, 'team2'));
      }
    };

    // ───────────────────────── 인증 ─────────────────────────
    socket.on('playerAuth', async ({ battleId, playerId, otp }) => {
      if (!battleId || !playerId || !otp) return socket.emit('authError', '플레이어 인증 실패');
      const valid = validatePlayerOTP(battleId, playerId, otp);
      if (!valid) return socket.emit('authError', '플레이어 인증 실패');

      socket.auth = { battleId, role: 'player', playerId, spectatorName: null, teamKey: null };
      await joinRoleRooms('player', battleId, playerId);

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { role: 'player', battle: state });
    });

    socket.on('adminAuth', async ({ battleId, otp }) => {
      if (!battleId || !otp) return socket.emit('authError', '관리자 인증 실패');
      const valid = validateAdminOTP(battleId, otp);
      if (!valid) return socket.emit('authError', '관리자 인증 실패');

      socket.auth = { battleId, role: 'admin', playerId: null, spectatorName: null, teamKey: null };
      await joinRoleRooms('admin', battleId);

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { role: 'admin', battle: state });
    });

    socket.on('spectatorAuth', async ({ battleId, otp, spectatorName }) => {
      if (!battleId || !otp) return socket.emit('authError', '관전자 인증 실패');
      const valid = validateSpectatorOTP(battleId, otp);
      if (!valid) return socket.emit('authError', '관전자 인증 실패');

      socket.auth = { battleId, role: 'spectator', playerId: null, spectatorName: sanitize(spectatorName) || '관전자', teamKey: null };
      await joinRoleRooms('spectator', battleId);

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { role: 'spectator', battle: state });
    });

    // 관리자 전용: 인증 없이 미리 조인(디버그/대시보드)
    socket.on('join-battle', async ({ battleId, role }) => {
      if (!battleId || !['admin','player','spectator'].includes(role)) return;
      socket.auth = { battleId, role, playerId: null, spectatorName: null, teamKey: null };
      await joinRoleRooms(role, battleId);
      const state = await getBattleForBroadcast(battleId);
      socket.emit('battle-state', { state }); // 레거시 이벤트
    });

    // ───────────────────────── 채팅: 전체/팀 ─────────────────────────
    const handleChatSend = async (raw) => {
      const now = Date.now();
      const battleId = raw?.battleId || socket.auth.battleId;
      if (!battleId) return;

      // 프런트별 페이로드 호환
      const msgText = sanitize(raw?.message ?? raw?.text ?? '');
      if (!msgText) return;

      const battle = await getBattleById(battleId);
      if (!battle) return;

      // 발신자 이름/타입 결정
      let senderType = socket.auth.role || 'system';
      let sender =
        raw?.sender ||
        (senderType === 'admin'     ? '관리자' :
         senderType === 'spectator' ? (socket.auth.spectatorName || '관전자') :
         senderType === 'player'    ? (() => {
           // 플레이어 이름 조회
           const all = [
             ...(battle.teams?.team1?.players || []),
             ...(battle.teams?.team2?.players || []),
           ];
           const found = all.find(p => p.id === socket.auth.playerId);
           return found?.name || '플레이어';
         })() : '시스템');

      // /t 접두 = 팀 전용
      // 허용 패턴: "/t ..." , "/T ...", "/팀 ..." (선행공백 허용)
      const teamOnly = /^\s*(\/t|\/T|\/팀)\b/.test(msgText);
      const finalMessage = teamOnly ? msgText.replace(/^\s*(\/t|\/T|\/팀)\s*/, '') : msgText;

      // 전용 팀키 계산(관리자면 소켓에 팀키 없음 → 팀 미지정 채팅은 전체로 처리)
      let teamKey = null;
      if (teamOnly) {
        if (senderType === 'player') {
          teamKey = socket.auth.teamKey || getPlayerTeamKey(battle, socket.auth.playerId);
        } else if (senderType === 'admin') {
          // 관리자가 특정 팀 전용으로 보낼 경우: payload.teamKey 지원(선택)
          teamKey = raw?.teamKey === 'team2' ? 'team2' : 'team1';
        }
        if (!teamKey) return; // 팀을 특정할 수 없으면 무시
      }

      const entry = {
        sender,
        senderType,
        message: finalMessage,
        timestamp: now,
        teamOnly: !!teamOnly,
        teamKey,
        isAdmin: senderType === 'admin',
      };

      // 영속(또는 메모리) 저장
      try { await saveChatMessage(battleId, entry); } catch (_) { /* 저장 실패는 무시하고 송신 계속 */ }

      // 실시간 팬아웃(신/구 이벤트 병행)
      fanoutChat(battleId, {
        timestamp: now,
        name: sender,
        message: finalMessage,
        teamOnly: !!teamOnly,
        teamKey: teamKey || null,
        isAdmin: senderType === 'admin',
      }, { teamOnly, teamKey });

      // 상태 스냅샷도 최신화 브로드캐스트(선택)
      broadcastState(battleId);
    };

    // 새/구 이벤트 이름 모두 수신
    socket.on('send-chat', handleChatSend);
    socket.on('chat',       (p) => handleChatSend({ ...p, battleId: p?.battleId || socket.auth.battleId }));
    socket.on('chatMessage',(p) => handleChatSend({ ...p, battleId: p?.battleId || socket.auth.battleId }));

    // ───────────────────────── 응원 메시지 ─────────────────────────
    const handleCheer = async (raw) => {
      const battleId = raw?.battleId || socket.auth.battleId;
      if (!battleId) return;
      if (socket.auth.role !== 'spectator') return; // 관전자만
      const msg = sanitize(raw?.message);
      if (!ALLOWED_CHEERS.has(msg)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');

      const now = Date.now();
      const entry = {
        sender: socket.auth.spectatorName || '관전자',
        senderType: 'spectator',
        message: msg,
        timestamp: now,
        teamOnly: false,
        teamKey: null,
        isAdmin: false,
      };
      try { await saveChatMessage(battleId, entry); } catch (_) {}

      fanoutChat(battleId, {
        timestamp: now,
        name: entry.sender,
        message: `[응원] ${msg}`,
        teamOnly: false,
        teamKey: null,
        isAdmin: false,
      }, { teamOnly: false });

      broadcastState(battleId);
    };
    socket.on('cheer', handleCheer);
    socket.on('cheerMessage', handleCheer);

    // ───────────────────────── 공지 핀(관리자) ─────────────────────────
    socket.on('admin-notice', async ({ battleId, text }) => {
      if (socket.auth.role !== 'admin') return;
      const b = await getBattleById(battleId);
      if (!b) return;
      if (!b.notice) b.notice = {};
      b.notice.text = sanitize(text);

      // 관전자/플레이어/관리자 모두에게 공지 업데이트
      io.to(ROOM(battleId, 'admin')).emit('noticeUpdate', { text: b.notice.text });
      io.to(ROOM(battleId, 'player')).emit('noticeUpdate', { text: b.notice.text });
      io.to(ROOM(battleId, 'spectator')).emit('noticeUpdate', { text: b.notice.text });
      io.to(TEAM_ROOM(battleId, 'team1')).emit('noticeUpdate', { text: b.notice.text });
      io.to(TEAM_ROOM(battleId, 'team2')).emit('noticeUpdate', { text: b.notice.text });

      await broadcastState(battleId);
    });

    // ───────────────────────── 플레이어 액션(선택적 연동) ─────────────────────────
    socket.on('playerAction', async (payload) => {
      const battleId = payload?.battleId || socket.auth.battleId;
      const playerId = payload?.playerId || socket.auth.playerId;
      const action = typeof payload?.action === 'string' ? { type: payload.action } : (payload?.action || {});
      if (!battleId || !playerId || !action?.type) return socket.emit('actionError', 'bad_request');

      if (!executeAction) {
        // 엔진 미연동 환경: 안전 응답
        return socket.emit('actionError', 'not_supported');
      }

      try {
        const result = await executeAction(battleId, playerId, action);
        socket.emit('actionSuccess', result || { ok: true });

        // 상태 갱신 브로드캐스트
        await broadcastState(battleId);
      } catch (e) {
        socket.emit('actionError', String(e?.message || 'action_failed'));
      }
    });

    // ───────────────────────── 연결 종료 처리 ─────────────────────────
    socket.on('disconnect', async () => {
      // 필요 시 여기서 플레이어 온라인 상태 갱신/브로드캐스트
      // (store/engine에 updatePlayerConnection이 있다면 호출)
    });
  });
};
