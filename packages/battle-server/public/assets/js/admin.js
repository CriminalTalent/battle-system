// 목록에 전투 참가자 추가
    addPlayerToRoster(player) {
      const rosterEl = player.team === 'phoenix' ? elements.rosterPhoenix : elements.rosterDE;
      if (!rosterEl) return;

      const playerCard = document.createElement('div');
      playerCard.className = 'player-card';
      playerCard.dataset.playerId = player.id;
      playerCard.innerHTML = `
        <div class="player-header">
          ${player.avatar ? `<img src="${player.avatar}" class="player-avatar" alt="${player.name}">` : '<div class="player-avatar-placeholder">👤</div>'}
          <div class="player-info">
            <h4 class="player-name">${player.name}</h4>
            <div class="player-stats">
              <span class="stat">공격: ${player.stats.attack}</span>
              <span class="stat">방어: ${player.stats.defense}</span>
              <span class="stat">민첩: ${player.stats.dexterity}</span>
              <span class="stat">행운: ${player.stats.luck}</span>
            </div>
          </div>
        </div>
        <div class="player-details">
          <div class="hp-bar">
            <span class="hp-text">HP: ${player.hp}/${player.maxHp}</span>
            <div class="hp-fill" style="width: ${(player.hp/player.maxHp)*100}%"></div>
          </div>
          <div class="items">
            ${player.items.deterni > 0 ? `<span class="item">디터니 x${player.items.deterni}</span>` : ''}
            ${player.items.atkBoost > 0 ? `<span class="item">공격 보정기 x${player.items.atkBoost}</span>` : ''}
            ${player.items.defBoost > 0 ? `<span class="item">방어 보정기 x${player.items.defBoost}</span>` : ''}
          </div>
        </div>
        <button class="remove-player-btn" onclick="PyxisAdmin.removePlayer('${player.id}')">제거</button>
      `;
      
      rosterEl.appendChild(playerCard);
      this.updatePlayerCount();
    },

    // 전투 참가자 제거
    removePlayer(playerId) {
      if (confirm('이 전투 참가자를 제거하시겠습니까?')) {
        state.socket.emit('removePlayer', { playerId, battleId: state.battleId });
      }
    },

    // 전투 참가자 수 업데이트
    updatePlayerCount() {
      const phoenixCount = elements.rosterPhoenix?.children.length || 0;
      const deCount = elements.rosterDE?.children.length || 0;
      state.players = phoenixCount + deCount;
      elements.playerCount.    // URL 생성
    generateUrls() {
      if (!state.battleId) return;
      
      const baseUrl = window.location.origin;
      const adminUrl = `${baseUrl}/admin?battle=${state.battleId}`;
      const playerUrl = `${baseUrl}/play?battle=${state.battleId}`;
      const spectatorUrl = `${baseUrl}/watch?battle=${state.battleId}`;
      
      elements.adminUrl.textContent = adminUrl;
      elements.playerUrl.textContent = playerUrl;
      elements.spectatorUrl.textContent = spectatorUrl;
    },/* PYXIS Admin - 우아한 전투 관리 시스템 */
(function() {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // DOM 요소들
  const elements = {
    // 전투 제어
    battleMode: $('#battleMode'),
    btnCreateBattle: $('#btnCreateBattle'),
    battleId: $('#battleId'),
    
    // 제어 버튼
    btnStart: $('#btnStart'),
    btnPause: $('#btnPause'),
    btnResume: $('#btnResume'),
    btnEnd: $('#btnEnd'),
    
    // 링크 생성
    btnGenPlayerOtp: $('#btnGenPlayerOtp'),
    btnGenSpectatorOtp: $('#btnGenSpectatorOtp'),
    playerOtp: $('#playerOtp'),
    spectatorOtp: $('#spectatorOtp'),
    adminUrl: $('#adminUrl'),
    playerUrl: $('#playerUrl'),
    spectatorUrl: $('#spectatorUrl'),
    
    // 플레이어 추가
    pName: $('#pName'),
    pTeam: $('#pTeam'),
    pAvatar: $('#pAvatar'),
    pAvatarPreview: $('#pAvatarPreview'),
    pAvatarMeta: $('#pAvatarMeta'),
    
    // 스탯
    sATK: $('#sATK'),
    sDEF: $('#sDEF'),
    sDEX: $('#sDEX'),
    sLUK: $('#sLUK'),
    pHP: $('#pHP'),
    statTotal: $('#statTotal'),
    
    // 아이템
    itemDeterni: $('#itemDeterni'),
    itemAtkBoost: $('#itemAtkBoost'),
    itemDefBoost: $('#itemDefBoost'),
    
    btnAddPlayer: $('#btnAddPlayer'),
    addPlayerMsg: $('#addPlayerMsg'),
    
    // 로스터
    rosterPhoenix: $('#rosterPhoenix'),
    rosterDE: $('#rosterDE'),
    
    // 로그 & 채팅
    battleLog: $('#battleLog'),
    chatView: $('#chatView'),
    chatText: $('#chatText'),
    btnChatSend: $('#btnChatSend'),
    
    // 상태
    statusPill: $('#statusPill'),
    spectatorCount: $('#spectatorCount'),
    playerCount: $('#playerCount')
  };

  // 상태 관리
  let state = {
    battleId: null,
    battleStatus: 'waiting',
    socket: null,
    currentBattleData: null,
    spectators: 0,
    players: 0,
    avatarFile: null
  };

  // 메인 관리자 객체
  window.PyxisAdmin = {
    init() {
      this.setupSocket();
      this.bindEvents();
      this.updateStats();
      this.generateUrls();
      console.log('PYXIS 관리자 시스템 초기화 완료');
    },

    setupSocket() {
      if (!window.io) {
        console.error('Socket.IO가 로드되지 않았습니다');
        return;
      }

      state.socket = window.io({
        transports: ['websocket', 'polling'],
        upgrade: true
      });

      // 소켓 이벤트 바인딩
      state.socket.on('connect', () => {
        console.log('관리자 소켓 연결됨');
        this.showToast('서버 연결됨', 'success');
      });

      state.socket.on('disconnect', () => {
        console.log('관리자 소켓 연결 해제됨');
        this.showToast('서버 연결 해제됨', 'warning');
      });

      state.socket.on('battleCreated', (data) => {
        state.battleId = data.battleId;
        elements.battleId.textContent = data.battleId;
        this.showToast(`전투 생성됨: ${data.battleId}`, 'success');
        this.updateBattleStatus('created');
      });

      state.socket.on('battleStarted', () => {
        this.updateBattleStatus('active');
        this.showToast('전투가 시작되었습니다!', 'success');
      });

      state.socket.on('battleEnded', (data) => {
        this.updateBattleStatus('ended');
        this.showToast(`전투 종료: ${data.winner} 승리!`, 'info');
      });

      state.socket.on('playerAdded', (data) => {
        this.addPlayerToRoster(data.player);
        this.showToast(`플레이어 추가: ${data.player.name}`, 'success');
        elements.pName.value = '';
        this.clearStats();
        this.updatePlayerCount();
      });

      state.socket.on('battleLog', (data) => {
        this.addBattleLog(data);
      });

      state.socket.on('chatMessage', (data) => {
        this.addChatMessage(data);
      });

      state.socket.on('spectatorCount', (count) => {
        state.spectators = count;
        elements.spectatorCount.textContent = count;
      });

      state.socket.on('playerJoined', () => {
        this.updatePlayerCount();
      });

      state.socket.on('error', (error) => {
        console.error('소켓 에러:', error);
        this.showToast(`오류: ${error.message}`, 'error');
      });
    },

    bindEvents() {
      // 전투 생성
      elements.btnCreateBattle?.addEventListener('click', () => {
        const mode = elements.battleMode.value;
        this.createBattle(mode);
      });

      // 전투 제어
      elements.btnStart?.addEventListener('click', () => this.startBattle());
      elements.btnPause?.addEventListener('click', () => this.pauseBattle());
      elements.btnResume?.addEventListener('click', () => this.resumeBattle());
      elements.btnEnd?.addEventListener('click', () => this.endBattle());

      // 링크 생성
      elements.btnGenPlayerOtp?.addEventListener('click', () => this.generatePlayerOtp());
      elements.btnGenSpectatorOtp?.addEventListener('click', () => this.generateSpectatorOtp());

      // 이미지 업로드
      elements.pAvatar?.addEventListener('change', (e) => this.handleAvatarUpload(e));

      // 스탯 변경 감지
      [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK].forEach(el => {
        el?.addEventListener('input', () => this.updateStatTotal());
      });

      // 플레이어 추가
      elements.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

      // 채팅
      elements.btnChatSend?.addEventListener('click', () => this.sendChat());
      elements.chatText?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });

      // 클립보드 복사 (링크 요소 클릭시)
      [elements.adminUrl, elements.playerUrl, elements.spectatorUrl].forEach(el => {
        el?.addEventListener('click', () => this.copyToClipboard(el.textContent));
      });
    },

    // 전투 생성
    createBattle(mode) {
      if (!state.socket) return;
      
      state.socket.emit('createBattle', { mode });
      this.showToast('전투 생성 중...', 'info');
    },

    // 전투 제어
    startBattle() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      state.socket.emit('startBattle', { battleId: state.battleId });
    },

    pauseBattle() {
      state.socket.emit('pauseBattle', { battleId: state.battleId });
    },

    resumeBattle() {
      state.socket.emit('resumeBattle', { battleId: state.battleId });
    },

    endBattle() {
      if (confirm('정말로 전투를 종료하시겠습니까?')) {
        state.socket.emit('endBattle', { battleId: state.battleId });
      }
    },

    // OTP 생성
    generatePlayerOtp() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      
      state.socket.emit('generatePlayerOtp', { battleId: state.battleId });
      state.socket.once('playerOtpGenerated', (data) => {
        elements.playerOtp.innerHTML = data.otps.map(otp => 
          `<div class="otp-item">
            <span class="otp-player">${otp.playerName}</span>
            <span class="otp-code" onclick="PyxisAdmin.copyToClipboard('${window.location.origin}/play?otp=${otp.code}&battle=${state.battleId}')">${otp.code}</span>
          </div>`
        ).join('');
        this.showToast('플레이어 OTP 생성됨', 'success');
      });
    },

    generateSpectatorOtp() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      
      state.socket.emit('generateSpectatorOtp', { battleId: state.battleId });
      state.socket.once('spectatorOtpGenerated', (data) => {
        const url = `${window.location.origin}/watch?otp=${data.otp}&battle=${state.battleId}`;
        elements.spectatorOtp.innerHTML = `
          <div class="otp-item">
            <span class="otp-code" onclick="PyxisAdmin.copyToClipboard('${url}')">${data.otp}</span>
            <span class="otp-expires">30분 유효</span>
          </div>`;
        this.showToast('관전자 OTP 생성됨', 'success');
      });
    },

    // 아바타 업로드
    handleAvatarUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      // 파일 크기 체크 (5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('파일 크기는 5MB 이하여야 합니다', 'error');
        return;
      }

      // 이미지 타입 체크
      if (!file.type.startsWith('image/')) {
        this.showToast('이미지 파일만 업로드 가능합니다', 'error');
        return;
      }

      state.avatarFile = file;
      
      // 미리보기 생성
      const reader = new FileReader();
      reader.onload = (e) => {
        elements.pAvatarPreview.src = e.target.result;
        elements.pAvatarPreview.style.display = 'block';
        elements.pAvatarMeta.textContent = `${file.name} (${(file.size/1024).toFixed(1)}KB)`;
      };
      reader.readAsDataURL(file);
    },

    // 스탯 합계 업데이트
    updateStatTotal() {
      const total = [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK]
        .reduce((sum, el) => sum + parseInt(el.value || 0), 0);
      
      elements.statTotal.textContent = total;
      elements.statTotal.className = `stat-total ${total === 12 ? 'valid' : total > 12 ? 'over' : 'under'}`;
      
      // HP 계산 (기본 20 + 방어력 * 2)
      const hp = 20 + parseInt(elements.sDEF.value || 0) * 2;
      elements.pHP.value = hp;
    },

    clearStats() {
      [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK].forEach(el => el.value = 1);
      elements.pHP.value = 22;
      this.updateStatTotal();
    },

    // 플레이어 추가
    addPlayer() {
      const name = elements.pName.value.trim();
      const team = elements.pTeam.value;
      
      if (!name) {
        this.showToast('플레이어 이름을 입력하세요', 'warning');
        return;
      }

      const stats = {
        attack: parseInt(elements.sATK.value),
        defense: parseInt(elements.sDEF.value),
        dexterity: parseInt(elements.sDEX.value),
        luck: parseInt(elements.sLUK.value)
      };

      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      if (total !== 12) {
        this.showToast('스탯 총합은 12여야 합니다', 'warning');
        return;
      }

      const items = {
        deterni: parseInt(elements.itemDeterni.value || 0),
        atkBoost: parseInt(elements.itemAtkBoost.value || 0),
        defBoost: parseInt(elements.itemDefBoost.value || 0)
      };

      const playerData = {
        name,
        team,
        stats,
        hp: parseInt(elements.pHP.value),
        maxHp: parseInt(elements.pHP.value),
        items,
        battleId: state.battleId
      };

      // 아바타가 있으면 함께 전송
      if (state.avatarFile) {
        const formData = new FormData();
        formData.append('avatar', state.avatarFile);
        formData.append('playerData', JSON.stringify(playerData));
        
        // HTTP로 전송
        fetch('/api/addPlayerWithAvatar', {
          method: 'POST',
          body: formData
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            this.addPlayerToRoster(data.player);
            this.showToast(`플레이어 추가: ${data.player.name}`, 'success');
            this.resetPlayerForm();
          } else {
            this.showToast(data.error || '플레이어 추가 실패', 'error');
          }
        })
        .catch(error => {
          console.error('플레이어 추가 오류:', error);
          this.showToast('플레이어 추가 중 오류 발생', 'error');
        });
      } else {
        // 소켓으로 전송
        state.socket.emit('addPlayer', playerData);
      }
    },

    resetPlayerForm() {
      elements.pName.value = '';
      elements.pAvatar.value = '';
      elements.pAvatarPreview.style.display = 'none';
      elements.pAvatarMeta.textContent = '';
      state.avatarFile = null;
      this.clearStats();
    },

    // 로스터에 플레이어 추가
    addPlayerToRoster(player) {
      const rosterEl = player.team === 'phoenix' ? elements.rosterPhoenix : elements.rosterDE;
      if (!rosterEl) return;

      const playerCar
