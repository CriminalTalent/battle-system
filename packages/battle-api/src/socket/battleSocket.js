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
                        mode: data.mode || '1v1'
                    });
                    
                    socket.emit('battle_created', {
                        success: true,
                        battleId: battle.id,
                        battle: this.serializeBattle(battle)
                    });
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // 배틀 참가
            socket.on('join_battle', (data) => {
                try {
                    const player = {
                        id: socket.id,
                        name: data.playerName || 'Player',
                        maxHp: data.maxHp || 100,
                        attack: data.attack || 50,
                        defense: data.defense || 30,
                        agility: data.agility || 50
                    };

                    const battle = this.battleEngine.joinBattle(data.battleId, player);
                    
                    socket.join(data.battleId);
                    socket.battleId = data.battleId;
                    
                    this.io.to(data.battleId).emit('battle_updated', {
                        battle: this.serializeBattle(battle)
                    });
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // 액션 실행
            socket.on('execute_action', (data) => {
                try {
                    const result = this.battleEngine.executeAction(
                        socket.battleId,
                        socket.id,
                        data.action
                    );

                    const battle = this.battleEngine.getBattle(socket.battleId);
                    
                    this.io.to(socket.battleId).emit('action_result', {
                        result,
                        battle: this.serializeBattle(battle)
                    });
                } catch (error) {
                    socket.emit('error', { message: error.message });
                }
            });

            // 연결 해제
            socket.on('disconnect', () => {
                console.log(`Socket disconnected: ${socket.id}`);
                // 배틀에서 플레이어 제거 로직 필요시 추가
            });
        });
    }

    // 배틀 상태 직렬화 (클라이언트 전송용)
    serializeBattle(battle) {
        return {
            id: battle.id,
            status: battle.status,
            mode: battle.mode,
            teams: battle.teams,
            turnOrder: battle.turnOrder,
            currentTurnIndex: battle.currentTurnIndex,
            currentPlayer: battle.turnOrder[battle.currentTurnIndex],
            initiativeRolls: battle.initiativeRolls,
            battleLogs: battle.battleLogs.slice(-20), // 최근 20개 로그만
            createdAt: battle.createdAt
        };
    }
}

module.exports = BattleSocketHandler;
