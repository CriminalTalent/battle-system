/* =========================================================================
   PYXIS Battle System – Admin Page Script (Refactored)
   경로: packages/battle-server/public/assets/js/pages/admin.js
   요구사항:
     - 디자인 및 기본사항 변경 금지
     - 이모지 금지
     - 룰 변경 금지
   목적:
     - 기존 기능 유지하면서 구조 정리, 예외처리 강화, 아이디 불일치 방어
     - Socket.IO 인증/이벤트 일원화
     - 전투 생성/링크 발급/플레이어 등록/시작/종료 플로우 안정화
   ======================================================================== */

(function () {
  'use strict';

  // ------------------------------------------------------------
  // 유틸리티
  // ------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v || 0)));
  const toInt = (v, d = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };

  // 안전한 이벤트 바인딩
  function on(el, ev, fn, opts) {
    if (!el) return;
    el.addEventListener(ev, fn, opts);
  }

  // 토스트(간단 알림) – 디자인에 영향 없도록 최소 구현
  function toast(msg) {
    try {
      const root = document.body || document.documentElement;
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.position = 'fixed';
      t.style.right = '16px';
      t.style.top = '16px';
      t.style.padding = '10px 12px';
      t.style.background = 'rgba(20,22,28,.9)';
      t.style.color = '#e6d9b0';
      t.style.border = '1px solid rgba(212,186,141,.5)';
      t.style.borderRadius = '8px';
      t.style.fontSize = '12px';
      t.style.zIndex = 9999;
      root.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    } catch (_) {}
  }

  // 텍스트 복사
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사 완료');
    } catch {
      toast('복사 실패');
    }
  }

  // ------------------------------------------------------------
  // 고정 팀 이름
  // ------------------------------------------------------------
  const TEAM_A = '불사조 기사단';
  const TEAM_B = '죽음을 먹는 자들';

  // ------------------------------------------------------------
  // API 엔드포인트 (서버 구조에 맞춰 자동 추론 + 폴백)
  // ------------------------------------------------------------
  const API = {
    createBattle: (mode) =>
      fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }).then((r) => r.json()),

    getBattle: (id) =>
      fetch(`/api/battles/${encodeURIComponent(id)}`).then((r) => r.json()),

    addPlayer: (battleId, payload) =>
      fetch(`/api/battles/${encodeURIComponent(battleId)}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),

    generateLinks: (battleId) =>
      fetch(`/api/admin/battles/${encodeURIComponent(battleId)}/links`, {
        method: 'POST',
      }).then((r) => r.json()),

    startBattle: (battleId) =>
      fetch(`/api/admin/battles/${encodeURIComponent(battleId)}/start`, {
        method: 'POST',
      }).then((r) => r.json()),

    endBattle: (battleId) =>
      fetch(`/api/admin/battles/${encodeURIComponent(battleId)}/end`, {
        method: 'POST',
      }).then((r) => r.json()),
  };

  // ------------------------------------------------------------
  // DOM 참조(아이디가 다를 수 있어 다중 후보 지원)
  // ------------------------------------------------------------
  function findAny(ids = []) {
    for (const id of ids) {
      const node = byId(id) || $(`#${id}`);
      if (node) return node;
    }
    return null;
  }

  const el = {
    // 연결/상태
    connectionDot: findAny(['connectionDot', 'adminConnectionDot']),
    connectionText: findAny(['connectionText', 'adminConnectionText']),

    // 인증
    battleId: findAny(['adminBattleId', 'battleId', 'authBattleId']),
    adminOtp: findAny(['adminOtp', 'authAdminOtp', 'otpAdmin']),
    btnAuth: findAny(['btnAdminAuth', 'authBtn', 'adminAuthBtn']),

    // 전투 생성
    mode: findAny(['battleMode', 'modeSelect', 'createMode']),
    btnCreate: findAny(['btnCreateBattle', 'createBattleBtn']),

    // 링크 생성/표시
    btnGenLinks: findAny(['btnGenerateLinks', 'generateLinksBtn']),
    adminLinkOut: findAny(['adminLink', 'adminLinkOut']),
    spectatorLinkOut: findAny(['spectatorLink', 'spectatorLinkOut']),
    playerLinksOut: findAny(['playerLinks', 'playerLinksOut']),

    // 플레이어 추가
    playerName: findAny(['playerName', 'formPlayerName']),
    playerTeam: findAny(['playerTeam', 'formPlayerTeam', 'teamSelect']),
    statAtk: findAny(['statAtk', 'statAttack', 'inputAtk']),
    statDef: findAny(['statDef', 'statDefense', 'inputDef']),
    statAgi: findAny(['statAgi', 'statAgility', 'inputAgi']),
    statLuck: findAny(['statLuck', 'statLuckiness', 'inputLuck']),
    itemAtk: findAny(['itemAtkBoost', 'itemAttackBoost']),
    itemDef: findAny(['itemDefBoost', 'itemDefenseBoost']),
    itemHeal: findAny(['itemDiterni', 'itemHeal10']),
    btnAddPlayer: findAny(['btnAddPlayer', 'addPlayerBtn']),
    rosterTable: findAny(['rosterTable', 'rosterBody', 'playerTableBody']),

    // 전투 제어
    btnStart: findAny(['btnStartBattle', 'startBattleBtn']),
    btnEnd: findAny(['btnEndBattle', 'endBattleBtn']),

    // 로그/출력
    battleLog: findAny(['battleLog', 'logPanel', 'adminLogs']),
  };

  // ------------------------------------------------------------
  // Admin 컨트롤러
  // ------------------------------------------------------------
  class PyxisAdmin {
    constructor() {
      this.socket = null;
      this.connected = false;

      this.battleId = '';
      this.adminOtp = '';
      this.currentMode = '2v2';
      this.roster = []; // {id,name,team,stats,items}

      this.links = {
        admin: '',
        spectator: '',
        players: [], // [{name, link}]
      };

      this.bindUI();
      this.connectSocket();
    }

    // ----------------------------------------------------------
    // UI 초기화
    // ----------------------------------------------------------
    bindUI() {
      // 인증
      on(el.btnAuth, 'click', () => {
        const b = (el.battleId && el.battleId.value || '').trim();
        const o = (el.adminOtp && el.adminOtp.value || '').trim();
        if (!b || !o) {
          toast('전투ID와 관리자 OTP를 입력하세요');
          return;
        }
        this.battleId = b;
        this.adminOtp = o;
        this.emitAdminAuth();
      });

      // 전투 생성
      on(el.btnCreate, 'click', async () => {
        try {
          const mode =
            (el.mode && (el.mode.value || el.mode.dataset.value)) ||
            this.currentMode ||
            '2v2';
          const res = await API.createBattle(mode);
          if (!res || !res.ok) throw new Error(res && res.error || '생성 실패');
          this.battleId = res.id || res.battleId || '';
          if (el.battleId) el.battleId.value = this.battleId;
          toast(`전투 생성: ${this.battleId}`);
        } catch (err) {
          console.error(err);
          toast('전투 생성 실패');
        }
      });

      // 링크 생성
      on(el.btnGenLinks, 'click', async () => {
        if (!this.battleId) {
          toast('전투ID가 없습니다');
          return;
        }
        try {
          // HTTP API 우선, 소켓 폴백 지원
          const res = await API.generateLinks(this.battleId).catch(() => null);
          if (res && res.ok) {
            this.applyLinks(res);
            toast('링크 생성 완료');
          } else {
            // 소켓 폴백
            this.socket.emit(
              'admin:generateLinks',
              { battleId: this.battleId },
              (ack) => {
                if (ack && ack.ok) {
                  this.applyLinks(ack);
                  toast('링크 생성 완료');
                } else {
                  toast('링크 생성 실패');
                }
              }
            );
          }
        } catch (err) {
          console.error(err);
          toast('링크 생성 실패');
        }
      });

      // 플레이어 추가
      on(el.btnAddPlayer, 'click', async () => {
        if (!this.battleId) {
          toast('전투ID가 없습니다');
          return;
        }
        const name = (el.playerName && el.playerName.value || '').trim();
        if (!name) {
          toast('플레이어 이름을 입력하세요');
          return;
        }
        const teamRaw = (el.playerTeam && el.playerTeam.value) || TEAM_A;
        const team = teamRaw === TEAM_B ? TEAM_B : TEAM_A;

        const atk = clamp(toInt(el.statAtk && el.statAtk.value, 1), 1, 5);
        const def = clamp(toInt(el.statDef && el.statDef.value, 1), 1, 5);
        const agi = clamp(toInt(el.statAgi && el.statAgi.value, 1), 1, 5);
        const luk = clamp(toInt(el.statLuck && el.statLuck.value, 1), 1, 5);

        const items = [];
        if (el.itemAtk && el.itemAtk.checked) items.push('공격 보정기');
        if (el.itemDef && el.itemDef.checked) items.push('방어 보정기');
        if (el.itemHeal && el.itemHeal.checked) items.push('디터니');

        const payload = {
          name,
          team,
          stats: { atk, def, agi, luk },
          items,
        };

        try {
          const res = await API.addPlayer(this.battleId, payload);
          if (!res || !res.ok) throw new Error(res && res.error || '추가 실패');

          // 서버에서 플레이어 ID, OTP를 반환하는 경우 지원
          const p = {
            id: res.playerId || res.id || name,
            name,
            team,
            stats: payload.stats,
            items: payload.items || [],
            otp: res.otp || res.playerOtp || null,
          };
          this.upsertRoster(p);

          // 플레이어 개별 참가 링크 자동 구성(링크 API가 따로 주는 경우 우선)
          if (res.joinUrl) {
            this.addPlayerLink(name, res.joinUrl);
          } else if (p.otp) {
            const join = this.buildPlayerLink(this.battleId, p.otp, name);
            this.addPlayerLink(name, join);
          }

          this.renderRoster();
          toast('플레이어 추가 완료');
        } catch (err) {
          console.error(err);
          toast('플레이어 추가 실패');
        }
      });

      // 전투 시작/종료
      on(el.btnStart, 'click', async () => {
        if (!this.battleId) {
          toast('전투ID가 없습니다');
          return;
        }
        try {
          const viaHttp = await API.startBattle(this.battleId).catch(() => null);
          if (viaHttp && viaHttp.ok) {
            toast('전투 시작');
          } else {
            this.socket.emit(
              'admin:startBattle',
              { battleId: this.battleId },
              (ack) => {
                if (ack && ack.ok) toast('전투 시작');
                else toast('전투 시작 실패');
              }
            );
          }
        } catch (err) {
          console.error(err);
          toast('전투 시작 실패');
        }
      });

      on(el.btnEnd, 'click', async () => {
        if (!this.battleId) {
          toast('전투ID가 없습니다');
          return;
        }
        try {
          const viaHttp = await API.endBattle(this.battleId).catch(() => null);
          if (viaHttp && viaHttp.ok) {
            toast('전투 종료');
          } else {
            this.socket.emit(
              'admin:endBattle',
              { battleId: this.battleId },
              (ack) => {
                if (ack && ack.ok) toast('전투 종료');
                else toast('전투 종료 실패');
              }
            );
          }
        } catch (err) {
          console.error(err);
          toast('전투 종료 실패');
        }
      });
    }

    // ----------------------------------------------------------
    // 소켓
    // ----------------------------------------------------------
    connectSocket() {
      try {
        // 서버가 /socket.io 기본 경로 사용
        this.socket = window.io ? window.io() : null;
      } catch {
        this.socket = null;
      }

      if (!this.socket) {
        this.setConnState(false, '연결 실패');
        return;
      }

      this.socket.on('connect', () => {
        this.connected = true;
        this.setConnState(true, '연결됨');
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.setConnState(false, '연결 끊김');
      });

      // 표준 인증 이벤트 폴리시
      this.socket.on('authSuccess', (payload) => {
        toast('관리자 인증 성공');
        // 인증 후 배틀 상태 동기화
        if (payload && payload.battle) {
          this.applyBattleSnapshot(payload.battle);
        } else if (this.battleId) {
          this.fetchBattle();
        }
      });

      this.socket.on('authError', (msg) => {
        toast(typeof msg === 'string' ? msg : '관리자 인증 실패');
      });

      // 실시간 배틀 업데이트
      this.socket.on('battleUpdate', (state) => {
        this.applyBattleSnapshot(state);
      });

      // 에러/성공 공통 핸들
      this.socket.on('actionError', (e) => {
        console.warn('[actionError]', e);
        toast('요청 실패');
      });
      this.socket.on('actionSuccess', (m) => {
        if (m && m.message) this.appendLog(m.message);
      });

      // 채팅은 관리자에서 UI가 없을 수도 있으므로 무시 가능
      this.socket.on('chatMessage', (m) => {
        if (m && m.text) this.appendLog(`[채팅] ${m.user || '누군가'}: ${m.text}`);
      });
    }

    emitAdminAuth() {
      if (!this.socket || !this.connected) {
        toast('소켓 연결이 필요합니다');
        return;
      }
      this.socket.emit('adminAuth', {
        battleId: this.battleId,
        token: this.adminOtp,
      });
    }

    // ----------------------------------------------------------
    // 상태 동기화
    // ----------------------------------------------------------
    async fetchBattle() {
      if (!this.battleId) return;
      try {
        const res = await API.getBattle(this.battleId);
        if (res && res.ok && res.data) {
          this.applyBattleSnapshot(res.data);
        }
      } catch (err) {
        console.error(err);
      }
    }

    applyBattleSnapshot(state) {
      if (!state) return;

      // 모드/배틀ID
      if (!this.battleId && state.id) this.battleId = state.id;
      if (el.battleId && this.battleId) el.battleId.value = this.battleId;

      // 로스터
      if (Array.isArray(state.players)) {
        this.roster = state.players.map((p) => ({
          id: p.id || p.name,
          name: p.name,
          team: p.team === TEAM_B ? TEAM_B : TEAM_A,
          stats: {
            atk: clamp(p.stats?.atk ?? p.attack ?? 1, 1, 5),
            def: clamp(p.stats?.def ?? p.defense ?? 1, 1, 5),
            agi: clamp(p.stats?.agi ?? p.agility ?? 1, 1, 5),
            luk: clamp(p.stats?.luk ?? p.luck ?? 1, 1, 5),
          },
          items: Array.isArray(p.items) ? p.items.slice(0, 8) : [],
          otp: p.otp || null,
        }));
        this.renderRoster();
      }

      // 링크 힌트가 오면 반영
      if (state.links) {
        this.applyLinks(state.links);
      }

      // 로그
      if (Array.isArray(state.logs) && state.logs.length) {
        for (const lg of state.logs.slice(-10)) {
          if (lg && lg.message) this.appendLog(lg.message);
          else if (typeof lg === 'string') this.appendLog(lg);
        }
      }
    }

    // ----------------------------------------------------------
    // 링크 처리
    // ----------------------------------------------------------
    applyLinks(result) {
      // result: {adminUrl, spectatorUrl, playerUrls:[{name,url}]}
      const adminUrl =
        result.adminUrl || result.admin || result.admin_link || '';
      const spectatorUrl =
        result.spectatorUrl || result.spectator || result.spectator_link || '';
      const players =
        result.playerUrls ||
        result.players ||
        result.player_links ||
        [];

      this.links.admin = adminUrl || '';
      this.links.spectator = spectatorUrl || '';
      this.links.players = Array.isArray(players) ? players.slice() : [];

      if (el.adminLinkOut && this.links.admin) {
        el.adminLinkOut.textContent = this.links.admin;
        el.adminLinkOut.dataset.href = this.links.admin;
        on(el.adminLinkOut, 'click', () => copyText(this.links.admin), { once: true });
      }
      if (el.spectatorLinkOut && this.links.spectator) {
        el.spectatorLinkOut.textContent = this.links.spectator;
        el.spectatorLinkOut.dataset.href = this.links.spectator;
        on(el.spectatorLinkOut, 'click', () => copyText(this.links.spectator), { once: true });
      }
      if (el.playerLinksOut) {
        // 텍스트 출력 안전 처리
        const lines = this.links.players.map((p) => {
          if (typeof p === 'string') return p;
          if (p && p.name && p.url) return `${p.name}: ${p.url}`;
          return '';
        }).filter(Boolean);
        el.playerLinksOut.textContent = lines.join('\n');
      }
    }

    buildPlayerLink(battleId, playerOtp, name) {
      const base = location.origin.replace(/\/+$/, '');
      const q = new URLSearchParams({
        battle: battleId,
        token: playerOtp,
        name: name,
      }).toString();
      return `${base}/play?${q}`;
    }

    addPlayerLink(name, url) {
      if (!this.links.players) this.links.players = [];
      const idx = this.links.players.findIndex((p) => p && p.name === name);
      const entry = { name, url };
      if (idx >= 0) this.links.players[idx] = entry;
      else this.links.players.push(entry);
      if (el.playerLinksOut) {
        const lines = this.links.players.map((p) => `${p.name}: ${p.url}`);
        el.playerLinksOut.textContent = lines.join('\n');
      }
    }

    // ----------------------------------------------------------
    // 로스터
    // ----------------------------------------------------------
    upsertRoster(p) {
      const idx = this.roster.findIndex((x) => x.id === p.id || x.name === p.name);
      if (idx >= 0) this.roster[idx] = { ...this.roster[idx], ...p };
      else this.roster.push(p);
    }

    renderRoster() {
      if (!el.rosterTable) return;
      const rows = this.roster.map((p) => {
        const stats = p.stats || {};
        const items = Array.isArray(p.items) ? p.items.join(', ') : '';
        const team = p.team === TEAM_B ? TEAM_B : TEAM_A;
        return `
<tr>
  <td>${escapeHtml(p.name)}</td>
  <td>${escapeHtml(team)}</td>
  <td>${toInt(stats.atk, 1)}</td>
  <td>${toInt(stats.def, 1)}</td>
  <td>${toInt(stats.agi, 1)}</td>
  <td>${toInt(stats.luk, 1)}</td>
  <td>${escapeHtml(items)}</td>
</tr>`;
      });
      el.rosterTable.innerHTML = rows.join('');
    }

    // ----------------------------------------------------------
    // 로그
    // ----------------------------------------------------------
    appendLog(line) {
      if (!el.battleLog) return;
      const at = new Date();
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      const ss = String(at.getSeconds()).padStart(2, '0');
      const row = `[${hh}:${mm}:${ss}] ${line}`;
      const div = document.createElement('div');
      div.textContent = row;
      el.battleLog.appendChild(div);
      // 스크롤 하단 고정
      try {
        el.battleLog.scrollTop = el.battleLog.scrollHeight;
      } catch (_) {}
    }

    // ----------------------------------------------------------
    // 연결 상태 표시
    // ----------------------------------------------------------
    setConnState(ok, text) {
      if (el.connectionDot) {
        el.connectionDot.style.background = ok ? '#3e8f5a' : '#8a3d3d';
        el.connectionDot.style.boxShadow = ok
          ? '0 0 0 2px rgba(62,143,90,.25)'
          : '0 0 0 2px rgba(138,61,61,.25)';
      }
      if (el.connectionText) {
        el.connectionText.textContent = text || (ok ? '연결됨' : '연결 끊김');
      }
    }
  }

  // HTML 안전 출력
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------
  // 실행
  // ------------------------------------------------------------
  // 전역에 노출(기존 코드가 참조할 수 있도록)
  window.PyxisAdmin = window.PyxisAdmin || PyxisAdmin;

  // 자동 부팅: 페이지 로드 시 한 번만 생성
  if (!window.__pyxis_admin_boot__) {
    window.__pyxis_admin_boot__ = true;
    try {
      window.__pyxis_admin__ = new PyxisAdmin();
    } catch (e) {
      console.error('[PYXIS Admin] init error:', e);
      toast('초기화 실패');
    }
  }
})();
