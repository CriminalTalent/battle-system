const { v4: uuidv4 } = require('uuid');

class BattleEngine {
    constructor() {
        this.battles = new Map();
        this.turnTimers = new Map();
        
        // 아이템 정의
        this.itemDefinitions = {
            attack_booster: {
                id: 'attack_booster',
                name: '공격 보정기',
                description: '공격력을 15 증가시킵니다',
                type: 'booster',
                effect: { attack: 15 },
                duration: 3, // 3턴 지속
                usable: true
            },
            defense_booster: {
                id: 'defense_booster',
                name: '방어 보정기',
                description: '방어력을 10 증가시킵니다',
                type: 'booster',
                effect: { defense: 10 },
                duration: 3, // 3턴 지속
                usable: true
            },
            health_potion: {
                id: 'health_potion',
                name: '회복 물약',
                description: 'HP를 30 회복합니다',
                type: 'consumable',
                effect: { heal: 30 },
                usable: true
            }
        };
        
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
            
            // 팀별 아이템 인벤토리 (비밀)
            teamInventories: {
                team1: {},
                team2: {}
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
                itemsEnabled: config.settings?.itemsEnabled !== false, // 기본값 true
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

    // 플레이어 참가 (아이템 포함)
    joinBattle(battleId, player, teamItems = {}) {
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
        player.activeItems = {}; // 활성화된 아이템 효과
        
        battle.teams[targetTeam].push(player);
        battle.lastActivityAt = Date.now();
        
        // 팀 아이템 설정 (첫 번째 플레이어가 참가할 때)
        if (battle.teams[targetTeam].length === 1 && battle.settings.itemsEnabled) {
            this.setTeamItems(battle, targetTeam, teamItems);
        }
        
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

    // 팀 아이템 설정
    setTeamItems(battle, team, items) {
        const inventory = {};
        
        // 유효한 아이템만 추가
        for (const [itemId, quantity] of Object.entries(items)) {
            if (this.itemDefinitions[itemId] && quantity > 0) {
                inventory[itemId] = {
                    ...this.itemDefinitions[itemId],
                    quantity: Math.min(quantity, 3) // 최대 3개까지
                };
            }
        }
        
        battle.teamInventories[team] = inventory;
        
        const itemList = Object.values(inventory)
            .map(item => `${item.name} x${item.quantity}`)
            .join(', ');
            
        if (itemList) {
            this.addLog(battle, `${team} 아이템이 설정되었습니다: ${itemList}`);
        }
    }

    // 액션 실행 (아이템 사용 포함)
    executeAction(battleId, playerId, action) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'in_progress') throw new Error('Battle not in progress');

        const currentPlayer = this.getCurrentPlayer(battle);
        if (!currentPlayer || currentPlayer.id !== playerId) {
            throw new Error('Not your turn');
        }

        battle.lastActivityAt = Date.now();

        // 아이템 사용 액션
        if (action.type === 'use_item') {
            const result = this.useItem(battle, currentPlayer, action.itemId);
            if (!this.checkWinCondition(battle)) {
                this.nextTurn(battle);
            }
            return result;
        }

        // 타겟이 필요한 액션인 경우 타겟 선택 요구
        if (action.type === 'attack' && (!action.targets || action.targets.length === 0)) {
            const availableTargets = this.getAvailableTargets(battle, currentPlayer, action.type);
            return {
                requiresTargetSelection: true,
                availableTargets: availableTargets,
                maxTargets: 1
            };
        }

        // 기본 액션 처리
        const result = this.processAction(battle, currentPlayer, action);
        
        // 승리 조건 확인
        if (!this.checkWinCondition(battle)) {
            // 턴 종료
            this.nextTurn(battle);
        }
        
        return result;
    }

    // 아이템 사용
    useItem(battle, player, itemId) {
        if (!battle.settings.itemsEnabled) {
            throw new Error('Items are disabled in this battle');
        }

        const teamInventory = battle.teamInventories[player.team];
        const item = teamInventory[itemId];
        
        if (!item || item.quantity <= 0) {
            throw new Error('Item not available');
        }

        const itemDef = this.itemDefinitions[itemId];
        if (!itemDef.usable) {
            throw new Error('Item is not usable');
        }

        // 아이템 효과 적용
        const result = this.applyItemEffect(battle, player, itemDef);
        
        // 아이템 소모
        item.quantity--;
        if (item.quantity <= 0) {
            delete teamInventory[itemId];
        }

        this.addLog(battle, `${player.name}이 ${itemDef.name}을(를) 사용했습니다!`);
        
        return {
            type: 'use_item',
            user: player.name,
            item: itemDef.name,
            result: result
        };
    }

    // 아이템 효과 적용
    applyItemEffect(battle, player, item) {
        const result = { effects: [] };

        if (item.type === 'consumable') {
            // 소모품 (즉시 효과)
            if (item.effect.heal) {
                const healAmount = Math.min(item.effect.heal, player.maxHp - player.hp);
                player.hp += healAmount;
                result.effects.push({
                    type: 'heal',
                    amount: healAmount,
                    newHp: player.hp
                });
                this.addLog(battle, `${player.name}이 ${healAmount} HP를 회복했습니다! (${player.hp}/${player.maxHp})`);
            }
        } else if (item.type === 'booster') {
            // 보정기 (지속 효과)
            if (!player.activeItems[item.id]) {
                player.activeItems[item.id] = {
                    ...item,
                    remainingTurns: item.duration
                };

                // 스탯 적용
                if (item.effect.attack) {
                    player.attack = (player.attack || 50) + item.effect.attack;
                    result.effects.push({
                        type: 'stat_boost',
                        stat: 'attack',
                        amount: item.effect.attack,
                        duration: item.duration
                    });
                }

                if (item.effect.defense) {
                    player.defense = (player.defense || 30) + item.effect.defense;
                    result.effects.push({
                        type: 'stat_boost',
                        stat: 'defense',
                        amount: item.effect.defense,
                        duration: item.duration
                    });
                }

                this.addLog(battle, `${player.name}에게 ${item.name} 효과가 적용되었습니다! (${item.duration}턴 지속)`);
            } else {
                throw new Error('Item effect already active');
            }
        }

        return result;
    }

    // 아이템 효과 처리 (턴 종료 시)
    processItemEffects(battle) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        
        allPlayers.forEach(player => {
            const expiredItems = [];
            
            for (const [itemId, itemEffect] of Object.entries(player.activeItems)) {
                itemEffect.remainingTurns--;
                
                if (itemEffect.remainingTurns <= 0) {
                    expiredItems.push(itemId);
                    
                    // 스탯 보정 제거
                    if (itemEffect.effect.attack) {
                        player.attack = (player.attack || 50) - itemEffect.effect.attack;
                    }
                    if (itemEffect.effect.defense) {
                        player.defense = (player.defense || 30) - itemEffect.effect.defense;
                    }
                    
                    this.addLog(battle, `${player.name}의 ${itemEffect.name} 효과가 만료되었습니다.`);
                }
            }
            
            // 만료된 아이템 제거
            expiredItems.forEach(itemId => {
                delete player.activeItems[itemId];
            });
        });
    }

    // 팀 아이템 정보 가져오기 (해당 팀만)
    getTeamItems(battle, team) {
        if (!battle.settings.itemsEnabled) {
            return {};
        }
        return battle.teamInventories[team] || {};
    }

    // 플레이어의 사용 가능한 아이템 목록
    getUsableItems(battle, player) {
        if (!battle.settings.itemsEnabled) {
            return [];
        }

        const teamInventory = battle.teamInventories[player.team] || {};
        const usableItems = [];

        for (const [itemId, item] of Object.entries(teamInventory)) {
            if (item.quantity > 0 && item.usable) {
                // 보정기는 이미 사용 중이면 사용 불가
                if (item.type === 'booster' && player.activeItems[itemId]) {
                    continue;
                }
                
                usableItems.push({
                    id: itemId,
                    name: item.name,
                    description: item.description,
                    quantity: item.quantity,
                    type: item.type
                });
            }
        }

        return usableItems;
    }

    // 다음 턴 (아이템 효과 처리 포함)
    nextTurn(battle) {
        // 상태 효과 처리
        this.processStatusEffects(battle);
        
        // 아이템 효과 처리
        if (battle.settings.itemsEnabled) {
            this.processItemEffects(battle);
        }
        
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

    // 배틀 상태 직렬화 (팀별 아이템 정보 포함)
    serializeBattleForTeam(battle, team) {
        if (!battle) return null;
        
        const baseBattle = {
            id: battle.id,
            status: battle.status,
            mode: battle.mode,
            teams: battle.teams,
            turnOrder: battle.turnOrder,
            currentTurnIndex: battle.currentTurnIndex,
            currentPlayer: battle.turnOrder ? battle.turnOrder[battle.currentTurnIndex] : null,
            round: battle.round,
            initiativeRolls: battle.initiativeRolls,
            battleLogs: battle.battleLogs ? battle.battleLogs.slice(-20) : [], // 최근 20개 로그만
            winner: battle.winner,
            settings: battle.settings,
            createdAt: battle.createdAt
        };

        // 팀별 아이템 정보 추가 (해당 팀만)
        if (battle.settings.itemsEnabled && team) {
            baseBattle.teamItems = this.getTeamItems(battle, team);
        }

        return baseBattle;
    }

    // 기존 메서드들은 그대로 유지...
    getMaxTeamSize(mode) {
        const teamSizes = {
            '1v1': 1,
            '2v2': 2,
            '3v3': 3,
            '4v4': 4
        };
        return teamSizes[mode] || 1;
    }

    canStartBattle(battle) {
        const minPlayers = this.getMinPlayers(battle.mode);
        const totalPlayers = battle.teams.team1.length + battle.teams.team2.length;
        return totalPlayers >= minPlayers;
    }

    getMinPlayers(mode) {
        const playerCounts = {
            '1v1': 2,
            '2v2': 4,
            '3v3': 6,
            '4v4': 8
        };
        return playerCounts[mode] || 2;
    }

    startBattle(battleId) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'ready') throw new Error('Battle not ready');

        this.startInitiativePhase(battle);
        return battle;
    }

    startInitiativePhase(battle) {
        battle.status = 'initiative';
        battle.lastActivityAt = Date.now();
        this.addLog(battle, '선후공을 결정합니다!');

        const team1Agility = this.calculateTeamAgility(battle.teams.team1);
        const team2Agility = this.calculateTeamAgility(battle.teams.team2);

        const team1Dice = this.rollDice(100);
        const team2Dice = this.rollDice(100);

        const team1Total = team1Agility + team1Dice;
        const team2Total = team2Agility + team2Dice;

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

        this.addLog(battle, `Team 1: 민첩성(${team1Agility}) + 주사위(${team1Dice}) = ${team1Total}`);
        this.addLog(battle, `Team 2: 민첩성(${team2Agility}) + 주사위(${team2Dice}) = ${team2Total}`);

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
            this.addLog(battle, '동점! 다시 굴립니다...');
            setTimeout(() => this.startInitiativePhase(battle), 2000);
            return battle;
        }

        this.createTurnOrder(battle, firstTeam, secondTeam);
        this.beginBattle(battle);
        
        return battle;
    }

    calculateTeamAgility(team) {
        return team.reduce((total, player) => {
            return total + (player.agility || 50);
        }, 0);
    }

    rollDice(sides) {
        return Math.floor(Math.random() * sides) + 1;
    }

    createTurnOrder(battle, firstTeam, secondTeam) {
        const turnOrder = [];
        
        const firstTeamPlayers = battle.teams[firstTeam];
        const secondTeamPlayers = battle.teams[secondTeam];
        
        firstTeamPlayers.forEach(player => {
            turnOrder.push({...player, team: firstTeam});
        });
        
        secondTeamPlayers.forEach(player => {
            turnOrder.push({...player, team: secondTeam});
        });
        
        battle.turnOrder = turnOrder;
        battle.currentTurnIndex = 0;
        
        const orderLog = battle.turnOrder.map((p, i) => `${i + 1}. ${p.name} (${p.team})`).join(', ');
        this.addLog(battle, `턴 순서: ${orderLog}`);
    }

    beginBattle(battle) {
        battle.status = 'in_progress';
        battle.lastActivityAt = Date.now();
        this.addLog(battle, '배틀이 시작됩니다!');
        
        const firstPlayer = battle.turnOrder[0];
        this.addLog(battle, `${firstPlayer.name}의 턴입니다!`);
        
        this.startTurnTimer(battle);
    }

    getCurrentPlayer(battle) {
        if (!battle.turnOrder || battle.turnOrder.length === 0) return null;
        return battle.turnOrder[battle.currentTurnIndex];
    }

    getAvailableTargets(battle, attacker, actionType) {
        const targets = [];
        
        if (actionType === 'attack') {
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

    processAttack(battle, attacker, targets) {
        const results = [];
        
        for (const targetId of targets) {
            const target = this.findPlayerById(battle, targetId);
            if (!target || target.status !== 'alive') continue;
            
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
            
            const dodgeChance = Math.min((target.agility || 50) / 10, 30);
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
            
            let damage = Math.max(1, (attacker.attack || 50) - (target.defense || 30));
            
            if (target.defendBuff) {
                damage = Math.floor(damage * 0.5);
                target.defendBuff = false;
                this.addLog(battle, `${target.name}이 방어로 데미지를 감소시켰습니다!`);
            }
            
            const actualDamage = Math.floor(damage * (0.8 + Math.random() * 0.4));
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

    processDefend(battle, defender) {
        defender.defendBuff = true;
        this.addLog(battle, `${defender.name}이 방어 태세를 취했습니다! 다음 공격 데미지가 50% 감소합니다.`);
        return [{ message: '방어 태세', defenseBonus: 50 }];
    }

    processDodge(battle, dodger) {
        const originalAgility = dodger.agility || 50;
        dodger.agility = originalAgility + 20;
        dodger.dodgeBuff = 1;
        
        this.addLog(battle, `${dodger.name}이 회피에 집중합니다! 민첩성이 일시적으로 증가했습니다.`);
        return [{ message: '회피 집중', agilityBonus: 20 }];
    }

    findPlayerById(battle, playerId) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        return allPlayers.find(p => p.id === playerId);
    }

    processStatusEffects(battle) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        
        allPlayers.forEach(player => {
            if (player.dodgeBuff && player.dodgeBuff > 0) {
                player.dodgeBuff--;
                if (player.dodgeBuff === 0) {
                    player.agility = (player.agility || 50) - 20;
                    this.addLog(battle, `${player.name}의 회피 집중 효과가 사라졌습니다.`);
                }
            }
        });
    }

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

    handlePlayerDisconnect(battleId, playerId) {
        const battle = this.battles.get(battleId);
        if (!battle) return;
        
        const player = this.findPlayerById(battle, playerId);
        if (!player) return;
        
        if (battle.status === 'in_progress') {
            const currentPlayer = this.getCurrentPlayer(battle);
            if (currentPlayer && currentPlayer.id === playerId) {
                this.addLog(battle, `${player.name}이 연결이 끊어져 자동으로 방어합니다.`);
                this.processAction(battle, currentPlayer, { type: 'defend' });
                this.nextTurn(battle);
            }
        }
    }

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

    clearTurnTimer(battleId) {
        const timer = this.turnTimers.get(battleId);
        if (timer) {
            clearTimeout(timer);
            this.turnTimers.delete(battleId);
        }
    }

    addChatMessage(battle, message) {
        battle.chatMessages.push({
            ...message,
            timestamp: message.timestamp || Date.now()
        });
        
        if (battle.chatMessages.length > 100) {
            battle.chatMessages.splice(0, battle.chatMessages.length - 100);
        }
    }

    addLog(battle, message) {
        battle.battleLogs.push({
            timestamp: Date.now(),
            message
        });
        
        if (battle.battleLogs.length > 50) {
            battle.battleLogs.splice(0, battle.battleLogs.length - 50);
        }
    }

    getBattle(battleId) {
        const battle = this.battles.get(battleId);
        if (battle) {
            battle.lastActivityAt = Date.now();
        }
        return battle;
    }

    setupCleanupTimer() {
        setInterval(() => {
            this.cleanupOldBattles();
        }, 30 * 60 * 1000);
    }

    cleanupOldBattles() {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000;
        
        for (const [battleId, battle] of this.battles) {
            if (now - battle.lastActivityAt > maxAge) {
                console.log(`Cleaning up old battle: ${battleId}`);
                this.clearTurnTimer(battleId);
                this.battles.delete(battleId);
            }
        }
    }

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
