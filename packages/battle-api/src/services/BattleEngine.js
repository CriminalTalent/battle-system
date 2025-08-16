const { v4: uuidv4 } = require('uuid');

class BattleEngine {
    constructor() {
        this.battles = new Map();
        this.turnTimers = new Map();
        
        // 정리 작업을 위한 타이머 (30분마다 실행)
        this.setupCleanupTimer();
    }

    // 배틀 생성
    createBattle(config) {
        const battleId = uuidv4();
        const battle = {
            id: battleId,
            status: 'waiting', // waiting, ready, initiative, in_progress, finished
            mode: config.mode || '1v1', // 1v1, 2v2, 3v3, 4v4
            
            // 팀전 구조
            teams: {
                team1: [],
                team2: []
            },
            
            // 턴 관리
            turnOrder: [],           // 선후공 순서 배열
            currentTurnIndex: 0,     // 현재 턴 인덱스
            round: 1,                // 라운드 번호
            
            // 선후공 정보
            initiativeRolls: {
                team1: { agility: 0, diceRoll: 0, total: 0 },
                team2: { agility: 0, diceRoll: 0, total: 0 }
            },
            
            // 로그 및 채팅
            battleLogs: [],
            chatMessages: [],
            
            // 설정
            settings: {
                turnTimeLimit: config.settings?.turnTimeLimit || 30000, // 30초
                maxTurns: config.settings?.maxTurns || 50,
                ...config.settings
            },
            
            // 메타데이터
            winner: null,
            createdAt: Date.now(),
            lastActivityAt: Date.now()
        };

        this.battles.set(battleId, battle);
        console.log(`Battle created: ${battleId} (${battle.mode})`);
        return battle;
    }

    // 플레이어 참가
    joinBattle(battleId, player) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'waiting') throw new Error('Battle already started or finished');

        // 중복 참가 방지
        const existingPlayer = this.findPlayerById(battle, player.id);
        if (existingPlayer) throw new Error('Player already in battle');

        // 팀 배정 (균등하게)
        const team1Count = battle.teams.team1.length;
        const team2Count = battle.teams.team2.length;
        const targetTeam = team1Count <= team2Count ? 'team1' : 'team2';
        
        // 팀 크기 제한 확인
        const maxTeamSize = this.getMaxTeamSize(battle.mode);
        if (battle.teams[targetTeam].length >= maxTeamSize) {
            throw new Error('Team is full');
        }
        
        // 플레이어 정보 설정
        player.team = targetTeam;
        player.position = battle.teams[targetTeam].length;
        player.hp = player.maxHp || 100;
        player.status = 'alive';
        player.defendBuff = false;
        player.dodgeBuff = 0;
        
        battle.teams[targetTeam].push(player);
        battle.lastActivityAt = Date.now();
        
        this.addLog(battle, `${player.name}이 ${targetTeam}에 참가했습니다.`);

        // 배틀 시작 가능한지 확인
        if (this.canStartBattle(battle)) {
            battle.status = 'ready';
        }

        return {
            team: targetTeam,
            position: player.position,
            battle: battle
        };
    }

    // 모드별 최대 팀 크기
    getMaxTeamSize(mode) {
        const teamSizes = {
            '1v1': 1,
            '2v2': 2,
            '3v3': 3,
            '4v4': 4
        };
        return teamSizes[mode] || 1;
    }

    // 배틀 시작 가능 여부 확인
    canStartBattle(battle) {
        const minPlayers = this.getMinPlayers(battle.mode);
        const totalPlayers = battle.teams.team1.length + battle.teams.team2.length;
        return totalPlayers >= minPlayers;
    }

    // 모드별 최소 플레이어 수
    getMinPlayers(mode) {
        const playerCounts = {
            '1v1': 2,
            '2v2': 4,
            '3v3': 6,
            '4v4': 8
        };
        return playerCounts[mode] || 2;
    }

    // 배틀 시작 (외부에서 호출)
    startBattle(battleId) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'ready') throw new Error('Battle not ready');

        this.startInitiativePhase(battle);
        return battle;
    }

    // 선후공 결정 페이즈 시작
    startInitiativePhase(battle) {
        battle.status = 'initiative';
        battle.lastActivityAt = Date.now();
        this.addLog(battle, '선후공을 결정합니다!');

        // 각 팀의 총 민첩성 계산
        const team1Agility = this.calculateTeamAgility(battle.teams.team1);
        const team2Agility = this.calculateTeamAgility(battle.teams.team2);

        // 주사위 굴리기 (1d100)
        const team1Dice = this.rollDice(100);
        const team2Dice = this.rollDice(100);

        // 이합 계산
        const team1Total = team1Agility + team1Dice;
        const team2Total = team2Agility + team2Dice;

        // 결과 저장
        battle.initiativeRolls.team1 = {
            agility: team1Agility,
            diceRoll: team1Dice,
            total: team1Total
        };
        battle.initiativeRolls.team2 = {
            agility: team2Agility,
            diceRoll: team2Dice,
            total: team2Total
        };

        // 로그 기록
        this.addLog(battle, `Team 1: 민첩성(${team1Agility}) + 주사위(${team1Dice}) = ${team1Total}`);
        this.addLog(battle, `Team 2: 민첩성(${team2Agility}) + 주사위(${team2Dice}) = ${team2Total}`);

        // 승부 결정
        let firstTeam, secondTeam;
        if (team1Total > team2Total) {
            firstTeam = 'team1';
            secondTeam = 'team2';
            this.addLog(battle, 'Team 1이 선공을 가져갑니다!');
        } else if (team2Total > team1Total) {
            firstTeam = 'team2';
            secondTeam = 'team1';
            this.addLog(battle, 'Team 2가 선공을 가져갑니다!');
        } else {
            // 동점일 경우 재굴림
            this.addLog(battle, '동점! 다시 굴립니다...');
            setTimeout(() => this.startInitiativePhase(battle), 2000);
            return battle;
        }

        // 턴 순서 생성
        this.createTurnOrder(battle, firstTeam, secondTeam);
        
        // 실제 배틀 시작
        this.beginBattle(battle);
        
        return battle;
    }

    // 팀 총 민첩성 계산
    calculateTeamAgility(team) {
        return team.reduce((total, player) => {
            return total + (player.agility || 50); // 기본 민첩성 50
        }, 0);
    }

    // 주사위 굴리기
    rollDice(sides) {
        return Math.floor(Math.random() * sides) + 1;
    }

    // 턴 순서 생성
    createTurnOrder(battle, firstTeam, secondTeam) {
        const turnOrder = [];
        
        // 선공팀이 먼저 턴을 가져감
        const firstTeamPlayers = battle.teams[firstTeam];
        const secondTeamPlayers = battle.teams[secondTeam];
        
        // 선공팀 전체가 먼저, 후공팀 전체가 나중에
        firstTeamPlayers.forEach(player => {
            turnOrder.push({...player, team: firstTeam});
        });
        
        secondTeamPlayers.forEach(player => {
            turnOrder.push({...player, team: secondTeam});
        });
        
        battle.turnOrder = turnOrder;
        battle.currentTurnIndex = 0;
        
        // 턴 순서 로그
        const orderLog = battle.turnOrder.map((p, i) => `${i + 1}. ${p.name} (${p.team})`).join(', ');
        this.addLog(battle, `턴 순서: ${orderLog}`);
    }

    // 배틀 실제 시작
    beginBattle(battle) {
        battle.status = 'in_progress';
        battle.lastActivityAt = Date.now();
        this.addLog(battle, '배틀이 시작됩니다!');
        
        const firstPlayer = battle.turnOrder[0];
        this.addLog(battle, `${firstPlayer.name}의 턴입니다!`);
        
        // 턴 타이머 시작
        this.startTurnTimer(battle);
    }

    // 현재 턴 플레이어 가져오기
    getCurrentPlayer(battle) {
        if (!battle.turnOrder || battle.turnOrder.length === 0) return null;
        return battle.turnOrder[battle.currentTurnIndex];
    }

    // 액션 실행
    executeAction(battleId, playerId, action) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'in_progress') throw new Error('Battle not in progress');

        const currentPlayer = this.getCurrentPlayer(battle);
        if (!currentPlayer || currentPlayer.id !== playerId) {
            throw new Error('Not your turn');
        }

        battle.lastActivityAt = Date.now();

        // 타겟이 필요한 액션인 경우 타겟 선택 요구
        if (action.type === 'attack' && (!action.targets || action.targets.length === 0)) {
            const availableTargets = this.getAvailableTargets(battle, currentPlayer, action.type);
            return {
                requiresTargetSelection: true,
                availableTargets: availableTargets,
                maxTargets: 1
            };
        }

        // 액션 처리
        const result = this.processAction(battle, currentPlayer, action);
        
        // 승리 조건 확인
        if (!this.checkWinCondition(battle)) {
            // 턴 종료
            this.nextTurn(battle);
        }
        
        return result;
    }

    // 사용 가능한 타겟 목록 가져오기
    getAvailableTargets(battle, attacker, actionType) {
        const targets = [];
        
        if (actionType === 'attack') {
            // 상대 팀의 살아있는 플레이어들
            const enemyTeam = attacker.team === 'team1' ? 'team2' : 'team1';
            battle.teams[enemyTeam].forEach(player => {
                if (player.status === 'alive') {
                    targets.push({
                        id: player.id,
                        name: player.name,
                        hp: player.hp,
                        maxHp: player.maxHp
                    });
                }
            });
        }
        
        return targets;
    }

    // 액션 처리 (공격/방어/회피)
    processAction(battle, attacker, action) {
        const { type, targets } = action;
        let results = [];

        switch (type) {
            case 'attack':
                if (!targets || targets.length === 0) {
                    throw new Error('Attack requires targets');
                }
                results = this.processAttack(battle, attacker, targets);
                break;
            case 'defend':
                results = this.processDefend(battle, attacker);
                break;
            case 'dodge':
                results = this.processDodge(battle, attacker);
                break;
            default:
                throw new Error('Invalid action type');
        }

        return { type, attacker: attacker.name, results };
    }

    // 공격 처리
    processAttack(battle, attacker, targets) {
        const results = [];
        
        for (const targetId of targets) {
            const target = this.findPlayerById(battle, targetId);
            if (!target || target.status !== 'alive') continue;
            
            // 명중률 계산 (기본 80%)
            const hitChance = 80;
            const hitRoll = this.rollDice(100);
            
            if (hitRoll > hitChance) {
                results.push({
                    targetName: target.name,
                    missed: true,
                    message: '공격이 빗나갔습니다!'
                });
                this.addLog(battle, `${attacker.name}의 공격이 ${target.name}에게 빗나갔습니다!`);
                continue;
            }
            
            // 회피 확인 (대상의 민첩성 기반)
            const dodgeChance = Math.min((target.agility || 50) / 10, 30); // 최대 30%
            const dodgeRoll = this.rollDice(100);
            
            if (dodgeRoll <= dodgeChance) {
                results.push({
                    targetName: target.name,
                    dodged: true,
                    message: '공격을 회피했습니다!'
                });
                this.addLog(battle, `${target.name}이 ${attacker.name}의 공격을 회피했습니다!`);
                continue;
            }
            
            // 데미지 계산
            let damage = Math.max(1, (attacker.attack || 50) - (target.defense || 30));
            
            // 방어 상태라면 데미지 50% 감소
            if (target.defendBuff) {
                damage = Math.floor(damage * 0.5);
                target.defendBuff = false; // 방어 버프 소모
                this.addLog(battle, `${target.name}이 방어로 데미지를 감소시켰습니다!`);
            }
            
            const actualDamage = Math.floor(damage * (0.8 + Math.random() * 0.4)); // 80-120%
            target.hp = Math.max(0, target.hp - actualDamage);
            
            if (target.hp <= 0) {
                target.status = 'dead';
                this.addLog(battle, `${target.name}이 쓰러졌습니다!`);
            }
            
            results.push({
                targetName: target.name,
                damage: actualDamage,
                remainingHp: target.hp,
                defeated: target.status === 'dead'
            });
            
            this.addLog(battle, `${attacker.name}이 ${target.name}에게 ${actualDamage} 데미지!`);
        }
        
        return results;
    }

    // 방어 처리
    processDefend(battle, defender) {
        // 다음 공격에 대해 50% 데미지 감소
        defender.defendBuff = true;
        this.addLog(battle, `${defender.name}이 방어 태세를 취했습니다! 다음 공격 데미지가 50% 감소합니다.`);
        return [{ message: '방어 태세', defenseBonus: 50 }];
    }

    // 회피 처리
    processDodge(battle, dodger) {
        // 민첩성을 일시적으로 증가시켜 회피율 상승
        const originalAgility = dodger.agility || 50;
        dodger.agility = originalAgility + 20; // 20 증가
        dodger.dodgeBuff = 1; // 1턴 동안 지속
        
        this.addLog(battle, `${dodger.name}이 회피에 집중합니다! 민첩성이 일시적으로 증가했습니다.`);
        return [{ message: '회피 집중', agilityBonus: 20 }];
    }

    // 플레이어 ID로 찾기
    findPlayerById(battle, playerId) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        return allPlayers.find(p => p.id === playerId);
    }

    // 다음 턴
    nextTurn(battle) {
        // 상태 효과 처리
        this.processStatusEffects(battle);
        
        // 살아있는 플레이어 중에서 다음 턴 찾기
        let attempts = 0;
        const maxAttempts = battle.turnOrder.length;
        
        do {
            battle.currentTurnIndex = (battle.currentTurnIndex + 1) % battle.turnOrder.length;
            attempts++;
            
            // 무한 루프 방지
            if (attempts >= maxAttempts) {
                console.error('Cannot find next alive player');
                this.endBattle(battle, null);
                return;
            }
        } while (battle.turnOrder[battle.currentTurnIndex].status !== 'alive');
        
        // 라운드 체크 (모든 플레이어가 한 번씩 턴을 마쳤을 때)
        if (battle.currentTurnIndex === 0) {
            battle.round++;
            this.addLog(battle, `라운드 ${battle.round} 시작!`);
            
            // 최대 턴 수 체크
            if (battle.round > battle.settings.maxTurns) {
                this.addLog(battle, '최대 턴 수에 도달했습니다. 배틀이 무승부로 종료됩니다.');
                this.endBattle(battle, 'draw');
                return;
            }
        }
        
        const nextPlayer = this.getCurrentPlayer(battle);
        this.addLog(battle, `${nextPlayer.name}의 턴입니다!`);
        
        this.startTurnTimer(battle);
    }

    // 상태 효과 처리 (버프/디버프 지속시간 감소)
    processStatusEffects(battle) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        
        allPlayers.forEach(player => {
            // 회피 버프 감소
            if (player.dodgeBuff && player.dodgeBuff > 0) {
                player.dodgeBuff--;
                if (player.dodgeBuff === 0) {
                    // 원래 민첩성으로 복구
                    player.agility = (player.agility || 50) - 20;
                    this.addLog(battle, `${player.name}의 회피 집중 효과가 사라졌습니다.`);
                }
            }
        });
    }

    // 승리 조건 확인
    checkWinCondition(battle) {
        const team1Alive = battle.teams.team1.filter(p => p.status === 'alive').length;
        const team2Alive = battle.teams.team2.filter(p => p.status === 'alive').length;
        
        if (team1Alive === 0) {
            this.endBattle(battle, 'team2');
            return true;
        } else if (team2Alive === 0) {
            this.endBattle(battle, 'team1');
            return true;
        }
        
        return false;
    }

    // 배틀 종료
    endBattle(battle, winner) {
        battle.status = 'finished';
        battle.winner = winner;
        battle.lastActivityAt = Date.now();
        this.clearTurnTimer(battle.id);
        
        if (winner === 'draw') {
            this.addLog(battle, '배틀이 무승부로 종료되었습니다!');
        } else if (winner) {
            this.addLog(battle, `${winner}이 승리했습니다!`);
        } else {
            this.addLog(battle, '배틀이 종료되었습니다.');
        }
    }

    // 플레이어 연결 해제 처리
    handlePlayerDisconnect(battleId, playerId) {
        const battle = this.battles.get(battleId);
        if (!battle) return;
        
        const player = this.findPlayerById(battle, playerId);
        if (!player) return;
        
        // 배틀이 진행 중이고 해당 플레이어의 턴이라면 자동으로 방어 처리
        if (battle.status === 'in_progress') {
            const currentPlayer = this.getCurrentPlayer(battle);
            if (currentPlayer && currentPlayer.id === playerId) {
                this.addLog(battle, `${player.name}이 연결이 끊어져 자동으로 방어합니다.`);
                this.processAction(battle, currentPlayer, { type: 'defend' });
                this.nextTurn(battle);
            }
        }
        
        // 대기 중인 배틀에서는 플레이어 제거 (구현 필요시)
        // if (battle.status === 'waiting') {
        //     // 플레이어 제거 로직
        // }
    }

    // 턴 타이머 시작
    startTurnTimer(battle) {
        this.clearTurnTimer(battle.id);
        
        const timer = setTimeout(() => {
            const currentPlayer = this.getCurrentPlayer(battle);
            if (currentPlayer && battle.status === 'in_progress') {
                this.addLog(battle, `${currentPlayer.name}의 턴 시간이 초과되어 자동으로 방어합니다.`);
                this.processAction(battle, currentPlayer, { type: 'defend' });
                if (!this.checkWinCondition(battle)) {
                    this.nextTurn(battle);
                }
            }
        }, battle.settings.turnTimeLimit);
        
        this.turnTimers.set(battle.id, timer);
    }

    // 턴 타이머 제거
    clearTurnTimer(battleId) {
        const timer = this.turnTimers.get(battleId);
        if (timer) {
            clearTimeout(timer);
            this.turnTimers.delete(battleId);
        }
    }

    // 채팅 메시지 추가 (필요시 사용)
    addChatMessage(battle, message) {
        battle.chatMessages.push({
            ...message,
            timestamp: message.timestamp || Date.now()
        });
        
        // 최대 100개 메시지 유지
        if (battle.chatMessages.length > 100) {
            battle.chatMessages.splice(0, battle.chatMessages.length - 100);
        }
    }

    // 로그 추가
    addLog(battle, message) {
        battle.battleLogs.push({
            timestamp: Date.now(),
            message
        });
        
        // 최대 50개 로그 유지
        if (battle.battleLogs.length > 50) {
            battle.battleLogs.splice(0, battle.battleLogs.length - 50);
        }
    }

    // 배틀 조회
    getBattle(battleId) {
        const battle = this.battles.get(battleId);
        if (battle) {
            battle.lastActivityAt = Date.now();
        }
        return battle;
    }

    // 정리 작업 타이머 설정
    setupCleanupTimer() {
        // 30분마다 오래된 배틀 정리
        setInterval(() => {
            this.cleanupOldBattles();
        }, 30 * 60 * 1000); // 30분
    }

    // 오래된 배틀 정리
    cleanupOldBattles() {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000; // 2시간
        
        for (const [battleId, battle] of this.battles) {
            if (now - battle.lastActivityAt > maxAge) {
                console.log(`Cleaning up old battle: ${battleId}`);
                this.clearTurnTimer(battleId);
                this.battles.delete(battleId);
            }
        }
    }

    // 통계 정보
    getStats() {
        const activeBattles = Array.from(this.battles.values()).filter(b => b.status === 'in_progress').length;
        const waitingBattles = Array.from(this.battles.values()).filter(b => b.status === 'waiting').length;
        const finishedBattles = Array.from(this.battles.values()).filter(b => b.status === 'finished').length;
        
        return {
            totalBattles: this.battles.size,
            activeBattles,
            waitingBattles,
            finishedBattles,
            activeTimers: this.turnTimers.size
        };
    }
}

module.exports = BattleEngine;
