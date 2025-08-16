const BattleEngine = require('../services/BattleEngine');

class BattleSocketHandler {
    constructor(io) {
        this.io = io;
        this.battleEngine = new BattleEngine();
        this.setupSocketHandlers();
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`Socket connected: ${socket.id}`);

            // 배틀 생성
            socket.on('create_battle', (data) => {
                try {
                    const battle = this.battleEngine.createBattle({
                        mode: data.mode || '1v1',
                        settings: {
                            itemsEnabled: data.settings?.itemsEnabled !== false, // 기본값 true
                            ...data.settings
                        }
                    });
                    
                    socket.emit('battle_created', {
                        success: true,
                        battleId: battle.id,
                        mode: battle.mode,
                        itemsEnabled: battle.settings.itemsEnabled,
                        battle: this.serializeBattle(battle)
                    });
                    
                    console.log(`Battle created: ${battle.id} (${battle.mode}) - Items: ${battle.settings.itemsEnabled}`);
                } catch (error) {
                    console.error('Create battle error:', error);
                    socket.emit('error', { message: error.message });
                }
            });

            // 배틀 참가 (아이템 포함)
            socket.on('join_battle', (data) => {
                try {
                    const player = {
                        id: socket.id,
                        name: data.player?.name || data.playerName || 'Player',
                        maxHp: data.player?.maxHp || data.maxHp || 100,
                        attack: data.player?.attack || data.attack || 50,
                        defense: data.player?.defense || data.defense || 30,
                        agility: data.player?.agility || data.agility || 50
                    };

                    // 팀 아이템 정보 (첫 번째 플레이어만)
                    const teamItems = data.teamItems || {};

                    const result = this.battleEngine.joinBattle(data.battleId, player, teamItems);
                    const battle = this.battleEngine.getBattle(data.battleId);
                    
                    socket.join(data.battleId);
                    socket.battleId = data.battleId;
                    socket.playerId = player.id;
                    socket.playerName = player.name;
                    socket.playerTeam = result.team;
                    
                    // 참가한 플레이어에게 개별 응답
                    socket.emit('battle_joined', {
                        success: true,
                        player: player,
                        team: result.team,
                        position: result.position,
                        battle: this.serializeBattleForTeam(battle, result.team)
                    });
                    
                    // 모든 참가자에게 배틀 상태 업데이트 (팀별로 다른 정보)
                    this.broadcastBattleUpdate(data.battleId, battle);
                    
                    // 시스템 메시지로 참가 알림
                    this.io.to(data.battleId).emit('system_message', {
                        message: `${player.name}님이 배틀에 참가했습니다.`,
                        timestamp: Date.now()
                    });
                    
                    // 배틀이 시작 가능한 상태인지 확인
                    if (battle.status === 'ready') {
                        this.startBattle(data.battleId);
                    }
                    
                    console.log(`Player joined battle: ${player.name} -> ${data.battleId} (Team: ${result.team})`);
                } catch (error) {
                    console.error('Join battle error:', error);
                    socket.emit('error', { message: error.message });
                }
            });

            // 액션 실행 (아이템 사용 포함)
            socket.on('execute_action', (data) => {
                try {
                    const result = this.battleEngine.executeAction(
                        socket.battleId,
                        socket.id,
                        data.action
                    );

                    const battle = this.battleEngine.getBattle(socket.battleId);
                    
                    // 타겟 선택이 필요한 경우
                    if (result.requiresTargetSelection) {
                        socket.emit('target_selection_required', {
                            action: data.action,
                            availableTargets: result.availableTargets,
                            maxTargets: result.maxTargets || 1
                        });
                        return;
                    }
                    
                    // 액션 결과를 모든 참가자에게 전송 (팀별로 다른 정보)
                    this.broadcastActionResult(socket.battleId, result, battle);
                    
                    // 배틀이 종료되었는지 확인
                    if (battle.status === 'finished') {
                        this.io.to(socket.battleId).emit('battle_finished', {
                            winner: battle.winner,
                            battle: this.serializeBattle(battle)
                        });
                        
                        this.io.to(socket.battleId).emit('system_message', {
                            message: `배틀이 종료되었습니다. 승리자: ${battle.winner}`,
                            timestamp: Date.now()
                        });
                    }
                    
                } catch (error) {
                    console.error('Execute action error:', error);
                    socket.emit('error', { message: error.message });
                }
            });

            // 사용 가능한 아이템 목록 요청
            socket.on('get_usable_items', (data) => {
                try {
                    if (!socket.battleId) {
                        socket.emit('error', { message: '배틀에 참가하지 않은 상태입니다.' });
                        return;
                    }

                    const battle = this.battleEngine.getBattle(socket.battleId);
                    const player = this.battleEngine.findPlayerById(battle, socket.id);
                    
                    if (!player) {
                        socket.emit('error', { message: '플레이어를 찾을 수 없습니다.' });
                        return;
                    }

                    const usableItems = this.battleEngine.getUsableItems(battle, player);
                    
                    socket.emit('usable_items', {
                        items: usableItems
                    });
                    
                } catch (error) {
                    console.error('Get usable items error:', error);
                    socket.emit('error', { message: error.message });
                }
            });

            // 팀 아이템 정보 요청 (같은 팀만)
            socket.on('get_team_items', (data) => {
                try {
                    if (!socket.battleId || !socket.playerTeam) {
                        socket.emit('error', { message: '배틀에 참가하지 않은 상태입니다.' });
                        return;
                    }

                    const battle = this.battleEngine.getBattle(socket.battleId);
                    const teamItems = this.battleEngine.getTeamItems(battle, socket.playerTeam);
                    
                    socket.emit('team_items', {
                        items: teamItems
                    });
                    
                } catch (error) {
                    console.error('Get team items error:', error);
                    socket.emit('error', { message: error.message });
                }
            });

            // 채팅 메시지 전송
            socket.on('chat_message', (data) => {
                try {
                    if (!socket.battleId || !socket.playerName) {
                        socket.emit('error', { message: '배틀에 참가하지 않은 상태입니다.' });
                        return;
                    }
                    
                    if (!data.text || data.text.trim().length === 0) {
                        return;
                    }
                    
                    const filteredText = this.filterMessage(data.text.trim());
                    
                    const chatMessage = {
                        type: 'chat',
                        playerId: socket.playerId,
                        playerName: socket.playerName,
                        text: filteredText,
                        timestamp: Date.now()
                    };
                    
                    this.io.to(socket.battleId).emit('chat_message', chatMessage);
                    
                    console.log(`Chat message from ${socket.playerName}: ${filteredText}`);
                    
                } catch (error) {
                    console.error('Chat message error:', error);
                    socket.emit('error', { message: '메시지 전송에 실패했습니다.' });
                }
            });

            // 배틀 상태 요청
            socket.on('get_battle_state', (data) => {
                try {
                    if (!data.battleId) {
                        socket.emit('error', { message: '배틀 ID가 필요합니다.' });
                        return;
                    }
                    
                    const battle = this.battleEngine.getBattle(data.battleId);
                    socket.emit('battle_state', {
                        battle: this.serializeBattleForTeam(battle, socket.playerTeam)
                    });
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // 연결 해제
            socket.on('disconnect', () => {
                console.log(`Socket disconnected: ${socket.id}`);
                
                if (socket.battleId && socket.playerName) {
                    this.io.to(socket.battleId).emit('system_message', {
                        message: `${socket.playerName}님이 연결을 해제했습니다.`,
                        timestamp: Date.now()
                    });
                    
                    try {
                        this.battleEngine.handlePlayerDisconnect(socket.battleId, socket.id);
                    } catch (error) {
                        console.error('Handle disconnect error:', error);
                    }
                }
            });
        });
    }

    // 배틀 시작
    startBattle(battleId) {
        try {
            const battle = this.battleEngine.startBattle(battleId);
            
            // 선후공 결정
            this.io.to(battleId).emit('initiative_rolled', {
                rolls: battle.initiativeRolls
            });
            
            // 배틀 시작 알림 (팀별로 다른 정보)
            this.broadcastBattleStarted(battleId, battle);
            
            this.io.to(battleId).emit('system_message', {
                message: '배틀이 시작되었습니다!',
                timestamp: Date.now()
            });
            
            // 첫 번째 턴 시작
            this.startTurn(battleId);
            
        } catch (error) {
            console.error('Start battle error:', error);
            this.io.to(battleId).emit('error', { message: '배틀 시작에 실패했습니다.' });
        }
    }

    // 턴 시작
    startTurn(battleId) {
        try {
            const battle = this.battleEngine.getBattle(battleId);
            const currentPlayer = battle.turnOrder[battle.currentTurnIndex];
            
            this.io.to(battleId).emit('turn_started', {
                currentPlayer: currentPlayer,
                turn: battle.currentTurnIndex + 1,
                round: battle.round
            });
            
            this.io.to(battleId).emit('system_message', {
                message: `${currentPlayer.name}님의 턴입니다.`,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Start turn error:', error);
        }
    }

    // 팀별로 다른 배틀 상태 브로드캐스트
    broadcastBattleUpdate(battleId, battle) {
        const room = this.io.sockets.adapter.rooms.get(battleId);
        if (!room) return;

        for (const socketId of room) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket && socket.playerTeam) {
                socket.emit('battle_updated', {
                    battle: this.serializeBattleForTeam(battle, socket.playerTeam)
                });
            }
        }
    }

    // 팀별로 다른 배틀 시작 정보 브로드캐스트
    broadcastBattleStarted(battleId, battle) {
        const room = this.io.sockets.adapter.rooms.get(battleId);
        if (!room) return;

        for (const socketId of room) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket && socket.playerTeam) {
                socket.emit('battle_started', {
                    battle: this.serializeBattleForTeam(battle, socket.playerTeam)
                });
            }
        }
    }

    // 팀별로 다른 액션 결과 브로드캐스트
    broadcastActionResult(battleId, result, battle) {
        const room = this.io.sockets.adapter.rooms.get(battleId);
        if (!room) return;

        for (const socketId of room) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket && socket.playerTeam) {
                socket.emit('action_result', {
                    result,
                    battleState: this.serializeBattleForTeam(battle, socket.playerTeam)
                });
            }
        }
    }

    // 메시지 필터링
    filterMessage(message) {
        const forbiddenWords = ['바보', '멍청이', '개새끼'];
        let filteredMessage = message;
        
        forbiddenWords.forEach(word => {
            const regex = new RegExp(word, 'gi');
            filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
        });
        
        return filteredMessage;
    }

    // 팀별 배틀 상태 직렬화
    serializeBattleForTeam(battle, team) {
        return this.battleEngine.serializeBattleForTeam(battle, team);
    }

    // 일반 배틀 상태 직렬화 (아이템 정보 제외)
    serializeBattle(battle) {
        if (!battle) return null;
        
        return {
            id: battle.id,
            status: battle.status,
            mode: battle.mode,
            teams: battle.teams,
            turnOrder: battle.turnOrder,
            currentTurnIndex: battle.currentTurnIndex,
            currentPlayer: battle.turnOrder ? battle.turnOrder[battle.currentTurnIndex] : null,
            round: battle.round,
            initiativeRolls: battle.initiativeRolls,
            battleLogs: battle.battleLogs ? battle.battleLogs.slice(-20) : [],
            winner: battle.winner,
            settings: battle.settings,
            createdAt: battle.createdAt
        };
    }
}

module.exports = BattleSocketHandler;
