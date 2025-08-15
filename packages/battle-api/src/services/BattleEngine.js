const { v4: uuidv4 } = require('uuid');

class BattleEngine {
    constructor() {
        this.battles = new Map();
        this.turnTimers = new Map();
    }

    // 배틀 생성
    createBattle(config) {
        const battleId = uuidv4();
        const battle = {
            id: battleId,
            status: 'waiting', // waiting, initiative, active, ended
            mode: config.mode || '1v1', // 1v1, 2v2, 3v3, 4v4
            
            // 팀전 구조
            teams: {
                team1: [],
                team2: []
            },
            
            // 턴 관리
            turnOrder: [],           // 선후공 순서 배열
            currentTurnIndex: 0,     // 현재 턴 인덱스
            
            // 선후공 정보
            initiativeRolls: {
                team1: { agility: 0, diceRoll: 0, total: 0 },
                team2: { agility: 0, diceRoll: 0, total: 0 }
            },
            
            battleLogs: [],
            createdAt: Date.now()
        };

        this.battles.set(battleId, battle);
        return battle;
    }

    // 플레이어 참가
    joinBattle(battleId, player) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'waiting') throw new Error('Battle already started');

        // 팀 배정 (균등하게)
        const team1Count = battle.teams.team1.length;
        const team2Count = battle.teams.team2.length;
        const targetTeam = team1Count <= team2Count ? 'team1' : 'team2';
        
        // 플레이어 정보 설정
        player.team = targetTeam;
        player.position = battle.teams[targetTeam].length;
        player.hp = player.maxHp || 100;
        player.status = 'alive';
        
        battle.teams[targetTeam].push(player);
        
        this.addLog(battle, `${player.name}이 ${targetTeam}에 참가했습니다.`);

        // 배틀 시작 가능한지 확인
        if (this.canStartBattle(battle)) {
            this.startInitiativePhase(battle);
        }

        return battle;
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

    // 선후공 결정 페이즈 시작
    startInitiativePhase(battle) {
        battle.status = 'initiative';
        this.addLog(battle, '선후공을 결정합니다!');

        // 각 팀의 총 민첩성 계산
        const team1Agility = this.calculateTeamAgility(battle.teams.team1);
        const team2Agility = this.calculateTeamAgility(battle.teams.team2);

        // 주사위 굴리기 (1d20)
        const team1Dice = this.rollDice(20);
        const team2Dice = this.rollDice(20);

        // 총합 계산
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
            return;
        }

        // 턴 순서 생성
        this.createTurnOrder(battle, firstTeam, secondTeam);
        
        // 3초 후 배틀 시작
        setTimeout(() => this.startBattle(battle), 3000);
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
        const orderLog = battle.turnOrder.map((p, i) => `${i + 1}. ${p.name} (${p.team})`).join('\n');
        this.addLog(battle, `턴 순서:\n${orderLog}`);
    }

    // 배틀 시작
    startBattle(battle) {
        battle.status = 'active';
        this.addLog(battle, '배틀이 시작됩니다!');
        
        const firstPlayer = battle.turnOrder[0];
        this.addLog(battle, `${firstPlayer.name}의 턴입니다!`);
        
        // 턴 타이머 시작 (30초)
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
        if (battle.status !== 'active') throw new Error('Battle not active');

        const currentPlayer = this.getCurrentPlayer(battle);
        if (!currentPlayer || currentPlayer.id !== playerId) {
            throw new Error('Not your turn');
        }

        // 액션 처리
        const result = this.processAction(battle, currentPlayer, action);
        
        // 턴 종료
        this.nextTurn(battle);
        
        return result;
    }

    // 액션 처리 (공격/방어/회피)
    processAction(battle, attacker, action) {
        const { type, targets } = action;
        let results = [];

        switch (type) {
            case 'attack':
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
            const dodgeChance = Math.min(target.agility || 50, 30); // 최대 30%
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
        // 승리 조건 확인
        if (this.checkWinCondition(battle)) {
            return;
        }
        
        // 버프/디버프 처리
        this.processStatusEffects(battle);
        
        // 살아있는 플레이어 중에서 다음 턴 찾기
        do {
            battle.currentTurnIndex = (battle.currentTurnIndex + 1) % battle.turnOrder.length;
        } while (battle.turnOrder[battle.currentTurnIndex].status !== 'alive');
        
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
        battle.status = 'ended';
        this.clearTurnTimer(battle.id);
        this.addLog(battle, `${winner}이 승리했습니다!`);
    }

    // 턴 타이머 시작
    startTurnTimer(battle) {
        this.clearTurnTimer(battle.id);
        
        const timer = setTimeout(() => {
            this.addLog(battle, '턴 시간 초과! 자동으로 방어합니다.');
            this.processAction(battle, this.getCurrentPlayer(battle), { type: 'defend' });
            this.nextTurn(battle);
        }, 30000); // 30초
        
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

    // 로그 추가
    addLog(battle, message) {
        battle.battleLogs.push({
            timestamp: Date.now(),
            message
        });
    }

    // 배틀 조회
    getBattle(battleId) {
        return this.battles.get(battleId);
    }
}

module.exports = BattleEngine;
