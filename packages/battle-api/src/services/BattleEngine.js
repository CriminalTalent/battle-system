// packages/battle-api/src/services/BattleEngine.js
// ===== 관전자 기능 통합 버전 =====
// 변경 요약
// - spectatorHandler 연동(setSpectatorHandler, notifySpectators 등)
// - 관전자용 안전 상태 스냅샷(getSpectatorSafeBattleState, getPublicBattles 등)
// - 관전자 접근 제어(초대 토큰, private, maxSpectators, ban/unban/isBanned)
// - 관전자 활동 로그/통계(getSpectatorStats, getDetailedSpectatorStats, logSpectatorActivity)
// - 배틀/액션 진행 시 관전자 브로드캐스트 훅(attack/defend/dodge, use_item, 상태 변경/종료)
// - 시작 시 startedAt 기록, battle 생성 시 spectators 등 관전자 관련 필드 초기화
//
// 주의
// - 기존 엔진은 teams: { team1: Player[], team2: Player[] } 구조이며, 팀 이름은 battle.teamNames에 존재.
// - 기존 로그는 battle.battleLogs[{timestamp, message}] 형태이므로, 관전자 필터는 메시지 기반으로 동작.
// - 액션 처리 후 notifySpectators 호출만 추가하고, 기존 리턴값/흐름은 보존.

const { v4: uuidv4 } = require('uuid');

class BattleEngine {
    constructor() {
        this.battles = new Map();
        this.turnTimers = new Map();

        // 관전자 소켓 핸들러 참조(선택)
        this.spectatorHandler = null;

        // 아이템 정의
        this.itemDefinitions = {
            attack_booster: {
                id: 'attack_booster',
                name: '공격 보정기',
                description: '공격력을 15 증가시킵니다',
                type: 'booster',
                effect: { attack: 15 },
                duration: 3,
                usable: true
            },
            defense_booster: {
                id: 'defense_booster',
                name: '방어 보정기',
                description: '방어력을 10 증가시킵니다',
                type: 'booster',
                effect: { defense: 10 },
                duration: 3,
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

        // 기본 팀 이름 템플릿 (관리자가 설정 가능)
        this.teamNameTemplates = {
            default: {
                team1Names: ['레드팀', '블루팀', '알파팀', '드래곤팀', '피닉스팀', '타이탄팀'],
                team2Names: ['옐로우팀', '그린팀', '베타팀', '울프팀', '이글팀', '라이온팀']
            },
            fantasy: {
                team1Names: ['그리폰 연합', '드래곤 클랜', '피닉스 길드', '유니콘 기사단', '펠린 워리어즈', '엘프 레인저스'],
                team2Names: ['오크 호드', '다크 로드', '쉐도우 어쌔신', '고블린 트라이브', '언데드 리전', '데몬 컬트']
            },
            modern: {
                team1Names: ['사이버 네오', '퓨처 포스', '테크 타이탄', '디지털 워리어', '로봇 레이더', 'AI 얼라이언스'],
                team2Names: ['네온 나이츠', '바이러스 헌터', '해커 크루', '글리치 길드', '픽셀 파이터', '코드 브레이커']
            },
            sports: {
                team1Names: ['파이어 이글스', '선더 볼츠', '아이언 타이거', '스카이 호크스', '골든 라이온', '실버 울브스'],
                team2Names: ['블랙 팬더', '와일드 비어', '스톰 샤크', '플레임 폭스', '아이스 울프', '윈드 팔콘']
            }
        };

        // 커스텀 팀 이름 (관리자가 추가 가능)
        this.customTeamNames = {
            team1: [],
            team2: []
        };

        // 정리 작업을 위한 타이머 (30분마다 실행)
        this.setupCleanupTimer();
    }

    // ===== 관전자 관련: 핸들러/기본 유틸 =====
    setSpectatorHandler(spectatorHandler) {
        this.spectatorHandler = spectatorHandler;
    }

    battleExists(battleId) {
        return this.battles.has(battleId);
    }

    notifySpectators(battleId, event, data) {
        if (this.spectatorHandler) {
            this.spectatorHandler.broadcastToSpectators(battleId, event, data);
        }
    }

    // ===== 팀 이름 템플릿 관리 =====
    addTeamNameTemplate(templateId, templateData) {
        const { team1Names, team2Names } = templateData;
        if (!templateId || !Array.isArray(team1Names) || !Array.isArray(team2Names)) {
            throw new Error('Template requires id, team1Names array, and team2Names array');
        }
        this.teamNameTemplates[templateId] = {
            team1Names: [...team1Names],
            team2Names: [...team2Names]
        };
        console.log(`Team name template added/updated: ${templateId}`);
        return this.teamNameTemplates[templateId];
    }

    addCustomTeamName(team, teamName) {
        if (team !== 'team1' && team !== 'team2') {
            throw new Error('Team must be either team1 or team2');
        }
        if (!teamName || teamName.trim().length === 0) {
            throw new Error('Team name cannot be empty');
        }
        const trimmedName = teamName.trim();
        if (!this.customTeamNames[team].includes(trimmedName)) {
            this.customTeamNames[team].push(trimmedName);
            console.log(`Custom team name added: ${trimmedName} to ${team}`);
        }
        return this.customTeamNames[team];
    }

    removeCustomTeamName(team, teamName) {
        if (team !== 'team1' && team !== 'team2') {
            throw new Error('Team must be either team1 or team2');
        }
        const index = this.customTeamNames[team].indexOf(teamName);
        if (index !== -1) {
            this.customTeamNames[team].splice(index, 1);
            console.log(`Custom team name removed: ${teamName} from ${team}`);
            return true;
        }
        return false;
    }

    generateTeamNames(templateId = 'default') {
        const template = this.teamNameTemplates[templateId] || this.teamNameTemplates.default;
        const team1Pool = [...this.customTeamNames.team1, ...template.team1Names];
        const team2Pool = [...this.customTeamNames.team2, ...template.team2Names];
        const team1Name = team1Pool[Math.floor(Math.random() * team1Pool.length)];
        const team2Name = team2Pool[Math.floor(Math.random() * team2Pool.length)];
        return { team1: team1Name, team2: team2Name };
    }

    getAvailableTeamNameTemplates() {
        return Object.keys(this.teamNameTemplates).map(templateId => ({
            id: templateId,
            team1Names: this.teamNameTemplates[templateId].team1Names,
            team2Names: this.teamNameTemplates[templateId].team2Names
        }));
    }

    getCustomTeamNames() {
        return {
            team1: [...this.customTeamNames.team1],
            team2: [...this.customTeamNames.team2]
        };
    }

    // ===== 배틀 생성/참가 =====
    createBattle(config) {
        const battleId = uuidv4();
        const teamNames = this.generateTeamNames(config.teamNameTemplate);

        const battle = {
            id: battleId,
            status: 'waiting', // waiting, ready, initiative, in_progress, finished
            mode: config.mode || '1v1',

            // 팀 구조
            teams: { team1: [], team2: [] },
            teamNames,

            // 팀별 아이템 인벤토리 (비밀)
            teamInventories: { team1: {}, team2: {} },

            // 턴/라운드
            turnOrder: [],
            currentTurnIndex: 0,
            round: 1,

            // 선후공 정보
            initiativeRolls: {
                team1: { agility: 0, diceRoll: 0, total: 0 },
                team2: { agility: 0, diceRoll: 0, total: 0 }
            },

            // 로그/채팅
            battleLogs: [],
            chatMessages: [],

            // 설정
            settings: {
                turnTimeLimit: config.settings?.turnTimeLimit || 300000,
                maxTurns: config.settings?.maxTurns || 50,
                itemsEnabled: config.settings?.itemsEnabled !== false,
                characterImagesEnabled: config.settings?.characterImagesEnabled || false,
                teamNameTemplate: config.teamNameTemplate || 'default',
                private: config.settings?.private || false,
                maxSpectators: config.settings?.maxSpectators || 50,
                requireInvite: config.settings?.requireInvite || false,
                ...config.settings
            },

            // 관전자 관련 필드
            spectators: new Set(),
            spectatorInvites: new Map(),
            invitedSpectators: [],
            bannedSpectators: new Set(),
            spectatorLogs: [],
            spectatorNotifications: {
                onPlayerAction: true,
                onTurnChange: true,
                onBattleEvents: true,
                onChatMessages: true
            },

            // 메타데이터
            winner: null,
            createdAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            lastActivityAt: Date.now()
        };

        this.battles.set(battleId, battle);
        console.log(`Battle created: ${battleId} (${battle.mode}) - Teams: ${teamNames.team1} vs ${teamNames.team2}`);
        return battle;
    }

    joinBattle(battleId, player, teamItems = {}) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'waiting') throw new Error('Battle already started or finished');

        // 중복 참가 방지
        const existingPlayer = this.findPlayerById(battle, player.id);
        if (existingPlayer) throw new Error('Player already in battle');

        // 팀 배정 (균등)
        const team1Count = battle.teams.team1.length;
        const team2Count = battle.teams.team2.length;
        const targetTeam = team1Count <= team2Count ? 'team1' : 'team2';

        const maxTeamSize = this.getMaxTeamSize(battle.mode);
        if (battle.teams[targetTeam].length >= maxTeamSize) {
            throw new Error('Team is full');
        }

        // 플레이어 초기화
        player.team = targetTeam;
        player.teamName = battle.teamNames[targetTeam];
        player.position = battle.teams[targetTeam].length;
        player.hp = player.maxHp || 100;
        player.status = 'alive';
        player.defendBuff = false;
        player.dodgeBuff = 0;
        player.activeItems = {}; // 활성화된 아이템 효과

        battle.teams[targetTeam].push(player);
        battle.lastActivityAt = Date.now();

        // 팀 아이템(첫 참가자 시 설정)
        if (battle.teams[targetTeam].length === 1 && battle.settings.itemsEnabled) {
            this.setTeamItems(battle, targetTeam, teamItems);
        }

        this.addLog(battle, `${player.name}이 ${battle.teamNames[targetTeam]}에 참가했습니다.`);

        // 시작 가능?
        if (this.canStartBattle(battle)) {
            battle.status = 'ready';
        }

        return {
            team: targetTeam,
            teamName: battle.teamNames[targetTeam],
            position: player.position,
            battle: battle
        };
    }

    setTeamItems(battle, team, items) {
        const inventory = {};
        for (const [itemId, quantity] of Object.entries(items)) {
            if (this.itemDefinitions[itemId] && quantity > 0) {
                inventory[itemId] = {
                    ...this.itemDefinitions[itemId],
                    quantity: Math.min(quantity, 3)
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

    // ===== 액션 실행 =====
    executeAction(battleId, playerId, action) {
        const battle = this.battles.get(battleId);
        if (!battle) throw new Error('Battle not found');
        if (battle.status !== 'in_progress') throw new Error('Battle not in progress');

        const currentPlayer = this.getCurrentPlayer(battle);
        if (!currentPlayer || currentPlayer.id !== playerId) {
            throw new Error('Not your turn');
        }

        battle.lastActivityAt = Date.now();

        // 아이템 사용
        if (action.type === 'use_item') {
            const useResult = this.useItem(battle, currentPlayer, action.itemId);

            // 관전자 알림(아이템명 블라인드)
            this.notifySpectators(battle.id, 'action_result', {
                result: this.filterActionResultForSpectators({
                    type: 'use_item',
                    attacker: currentPlayer.name,
                    item: useResult.item,
                    result: useResult.result
                }),
                battle: this.getSpectatorSafeBattleState(battle.id)
            });

            if (!this.checkWinCondition(battle)) {
                this.nextTurn(battle);
            }
            return useResult;
        }

        // 타겟 요구
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

        // 관전자 알림
        this.notifySpectators(battle.id, 'action_result', {
            result: this.filterActionResultForSpectators(result),
            battle: this.getSpectatorSafeBattleState(battle.id)
        });

        // 승리/턴 이동
        if (!this.checkWinCondition(battle)) {
            this.nextTurn(battle);
        }
        return result;
    }

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

        const result = this.applyItemEffect(battle, player, itemDef);

        // 소모
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

    applyItemEffect(battle, player, item) {
        const result = { effects: [] };

        if (item.type === 'consumable') {
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
            if (!player.activeItems[item.id]) {
                player.activeItems[item.id] = {
                    ...item,
                    remainingTurns: item.duration
                };
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

    processItemEffects(battle) {
        const allPlayers = [...battle.teams.team1, ...battle.teams.team2];
        allPlayers.forEach(player => {
            const expiredItems = [];
            for (const [itemId, itemEffect] of Object.entries(player.activeItems)) {
                itemEffect.remainingTurns--;
                if (itemEffect.remainingTurns <= 0) {
                    expiredItems.push(itemId);
                    if (itemEffect.effect.attack) {
                        player.attack = (player.attack || 50) - itemEffect.effect.attack;
                    }
                    if (itemEffect.effect.defense) {
                        player.defense = (player.defense || 30) - itemEffect.effect.defense;
                    }
                    this.addLog(battle, `${player.name}의 ${itemEffect.name} 효과가 만료되었습니다.`);
                }
            }
            expiredItems.forEach(itemId => {
                delete player.activeItems[itemId];
            });
        });
    }

    getTeamItems(battle, team) {
        if (!battle.settings.itemsEnabled) return {};
        return battle.teamInventories[team] || {};
    }

    getUsableItems(battle, player) {
        if (!battle.settings.itemsEnabled) return [];
        const teamInventory = battle.teamInventories[player.team] || {};
        const usableItems = [];
        for (const [itemId, item] of Object.entries(teamInventory)) {
            if (item.quantity > 0 && item.usable) {
                if (item.type === 'booster' && player.activeItems[itemId]) continue;
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

    nextTurn(battle) {
        // 상태효과
        this.processStatusEffects(battle);

        // 아이템 효과
        if (battle.settings.itemsEnabled) {
            this.processItemEffects(battle);
        }

        // 다음 생존자 찾기
        let attempts = 0;
        const maxAttempts = battle.turnOrder.length;
        do {
            battle.currentTurnIndex = (battle.currentTurnIndex + 1) % battle.turnOrder.length;
            attempts++;
            if (attempts >= maxAttempts) {
                console.error('Cannot find next alive player');
                this.endBattle(battle, null);
                // 관전자 알림
                this.notifySpectators(battle.id, 'battle_finished', {
                    winner: battle.winner,
                    battle: this.getSpectatorSafeBattleState(battle.id)
                });
                return;
            }
        } while (battle.turnOrder[battle.currentTurnIndex].status !== 'alive');

        // 라운드 갱신
        if (battle.currentTurnIndex === 0) {
            battle.round++;
            this.addLog(battle, `라운드 ${battle.round} 시작!`);
            if (battle.round > battle.settings.maxTurns) {
                this.addLog(battle, '최대 턴 수에 도달했습니다. 배틀이 무승부로 종료됩니다.');
                this.endBattle(battle, 'draw');
                this.notifySpectators(battle.id, 'battle_finished', {
                    winner: 'draw',
                    battle: this.getSpectatorSafeBattleState(battle.id)
                });
                return;
            }
        }

        const nextPlayer = this.getCurrentPlayer(battle);
        this.addLog(battle, `${nextPlayer.name}의 턴입니다!`);
        this.notifySpectators(battle.id, 'battle_updated', {
            battle: this.getSpectatorSafeBattleState(battle.id),
            statusChanged: false,
            newStatus: battle.status
        });

        this.startTurnTimer(battle);
    }

    // 팀별 시리얼라이즈(원래 기능 유지)
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
            battleLogs: battle.battleLogs ? battle.battleLogs.slice(-20) : [],
            winner: battle.winner,
            settings: battle.settings,
            createdAt: battle.createdAt,
            startedAt: battle.startedAt,
            finishedAt: battle.finishedAt
        };
        if (battle.settings.itemsEnabled && team) {
            baseBattle.teamItems = this.getTeamItems(battle, team);
        }
        if (battle.settings.characterImagesEnabled) {
            baseBattle.availableCharacterImages = this.getAvailableCharacterImages?.() || [];
        }
        return baseBattle;
    }

    startTurnTimer(battle) {
        this.clearTurnTimer(battle.id);
        const timer = setTimeout(() => {
            const currentPlayer = this.getCurrentPlayer(battle);
            if (currentPlayer && battle.status === 'in_progress') {
                this.addLog(battle, `${currentPlayer.name}의 턴 시간(5분)이 초과되어 자동으로 방어합니다.`);
                const autoResult = this.processAction(battle, currentPlayer, { type: 'defend' });
                this.notifySpectators(battle.id, 'action_result', {
                    result: this.filterActionResultForSpectators(autoResult),
                    battle: this.getSpectatorSafeBattleState(battle.id)
                });
                if (!this.checkWinCondition(battle)) {
                    this.nextTurn(battle);
                }
            }
        }, battle.settings.turnTimeLimit);
        this.turnTimers.set(battle.id, timer);
    }

    // ===== 기존 메서드들 유지 (일부 훅 추가) =====
    getMaxTeamSize(mode) {
        const teamSizes = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 };
        return teamSizes[mode] || 1;
    }

    canStartBattle(battle) {
        const minPlayers = this.getMinPlayers(battle.mode);
        const totalPlayers = battle.teams.team1.length + battle.teams.team2.length;
        return totalPlayers >= minPlayers;
    }

    getMinPlayers(mode) {
        const playerCounts = { '1v1': 2, '2v2': 4, '3v3': 6, '4v4': 8 };
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

        battle.initiativeRolls.team1 = { agility: team1Agility, diceRoll: team1Dice, total: team1Total };
        battle.initiativeRolls.team2 = { agility: team2Agility, diceRoll: team2Dice, total: team2Total };

        this.addLog(battle, `Team 1: 민첩성(${team1Agility}) + 주사위(${team1Dice}) = ${team1Total}`);
        this.addLog(battle, `Team 2: 민첩성(${team2Agility}) + 주사위(${team2Dice}) = ${team2Total}`);

        let firstTeam, secondTeam;
        if (team1Total > team2Total) {
            firstTeam = 'team1'; secondTeam = 'team2';
            this.addLog(battle, 'Team 1이 선공을 가져갑니다!');
        } else if (team2Total > team1Total) {
            firstTeam = 'team2'; secondTeam = 'team1';
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
        return team.reduce((total, player) => total + (player.agility || 50), 0);
    }

    rollDice(sides) {
        return Math.floor(Math.random() * sides) + 1;
    }

    createTurnOrder(battle, firstTeam, secondTeam) {
        const turnOrder = [];
        const firstTeamPlayers = battle.teams[firstTeam];
        const secondTeamPlayers = battle.teams[secondTeam];
        firstTeamPlayers.forEach(player => { turnOrder.push({ ...player, team: firstTeam }); });
        secondTeamPlayers.forEach(player => { turnOrder.push({ ...player, team: secondTeam }); });
        battle.turnOrder = turnOrder;
        battle.currentTurnIndex = 0;
        const orderLog = battle.turnOrder.map((p, i) => `${i + 1}. ${p.name} (${p.team})`).join(', ');
        this.addLog(battle, `턴 순서: ${orderLog}`);
    }

    beginBattle(battle) {
        battle.status = 'in_progress';
        battle.startedAt = Date.now();
        battle.lastActivityAt = Date.now();
        this.addLog(battle, '배틀이 시작됩니다!');
        const firstPlayer = battle.turnOrder[0];
        this.addLog(battle, `${firstPlayer.name}의 턴입니다! (제한시간: 5분)`);

        // 관전자에게 시작 알림
        this.notifySpectators(battle.id, 'battle_updated', {
            battle: this.getSpectatorSafeBattleState(battle.id),
            statusChanged: true,
            newStatus: 'in_progress'
        });

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
                        maxHp: player.maxHp,
                        characterImage: player.characterImage || null
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

        const actionResult = { type, attacker: attacker.name, results };

        // 관전자에게 액션 알림(필터 적용)
        this.notifySpectators(battle.id, 'action_result', {
            result: this.filterActionResultForSpectators(actionResult),
            battle: this.getSpectatorSafeBattleState(battle.id)
        });

        return actionResult;
    }

    processAttack(battle, attacker, targets) {
        const results = [];
        for (const targetId of targets) {
            const target = this.findPlayerById(battle, targetId);
            if (!target || target.status !== 'alive') continue;

            const hitChance = 80;
            const hitRoll = this.rollDice(100);
            if (hitRoll > hitChance) {
                results.push({ targetName: target.name, missed: true, message: '공격이 빗나갔습니다!' });
                this.addLog(battle, `${attacker.name}의 공격이 ${target.name}에게 빗나갔습니다!`);
                continue;
            }

            const dodgeChance = Math.min((target.agility || 50) / 10, 30);
            const dodgeRoll = this.rollDice(100);
            if (dodgeRoll <= dodgeChance) {
                results.push({ targetName: target.name, dodged: true, message: '공격을 회피했습니다!' });
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
        battle.finishedAt = Date.now();
        battle.lastActivityAt = Date.now();
        this.clearTurnTimer(battle.id);

        if (winner === 'draw') {
            this.addLog(battle, '배틀이 무승부로 종료되었습니다!');
        } else if (winner) {
            this.addLog(battle, `${winner}이 승리했습니다!`);
        } else {
            this.addLog(battle, '배틀이 종료되었습니다.');
        }

        // 관전자에게 종료 알림
        this.notifySpectators(battle.id, 'battle_finished', {
            winner,
            battle: this.getSpectatorSafeBattleState(battle.id)
        });
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
                const autoResult = this.processAction(battle, currentPlayer, { type: 'defend' });
                this.notifySpectators(battle.id, 'action_result', {
                    result: this.filterActionResultForSpectators(autoResult),
                    battle: this.getSpectatorSafeBattleState(battle.id)
                });
                this.nextTurn(battle);
            }
        }
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

        // 관전자 채팅 알림(옵션)
        if (battle.spectatorNotifications?.onChatMessages) {
            this.notifySpectators(battle.id, 'chat_message', {
                message: {
                    author: message.author ? this.anonymizeName(message.author) : '익명',
                    text: this.filterLogTextForSpectators(message.text || ''),
                    timestamp: message.timestamp || Date.now()
                }
            });
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
            activeTimers: this.turnTimers.size,
            availableCharacterImages: Object.keys(this.characterImages || {}).length
        };
    }

    // ====== 관전자용 안전 상태/로그 필터 ======
    getSpectatorSafeBattleState(battleId) {
        const battle = this.getBattle(battleId);
        if (!battle) return null;

        const currentPlayer = this.getCurrentPlayer(battle);
        const currentTeam = currentPlayer?.team || null;

        return {
            id: battle.id,
            mode: battle.mode,
            status: battle.status,
            currentTurn: battle.round,
            currentPlayerIndex: battle.currentTurnIndex,
            currentTeam,
            teams: {
                team1: {
                    players: battle.teams.team1.map(p => this.getSpectatorSafePlayerInfo(p)),
                    name: battle.teamNames?.team1 || '팀1'
                },
                team2: {
                    players: battle.teams.team2.map(p => this.getSpectatorSafePlayerInfo(p)),
                    name: battle.teamNames?.team2 || '팀2'
                }
            },
            logs: (battle.battleLogs || []).slice(-20).map(log => this.filterLogForSpectators(log)),
            settings: {
                turnTimeLimit: battle.settings?.turnTimeLimit,
                maxTurns: battle.settings?.maxTurns,
                itemsEnabled: battle.settings?.itemsEnabled,
                characterImagesEnabled: battle.settings?.characterImagesEnabled
            },
            spectatorCount: battle.spectators?.size || 0,
            winner: battle.winner,
            createdAt: battle.createdAt,
            startedAt: battle.startedAt,
            finishedAt: battle.finishedAt
        };
    }

    getSpectatorSafePlayerInfo(player) {
        // activeItems -> activeEffects로 일반화
        const effects = {};
        for (const [key, eff] of Object.entries(player.activeItems || {})) {
            effects[key] = {
                type: eff.type || (eff.effect?.heal ? 'heal' : (eff.effect?.attack || eff.effect?.defense ? 'booster' : 'unknown')),
                remainingTurns: eff.remainingTurns ?? null,
                name: this.getGenericEffectName(
                    eff.type || (eff.effect?.heal ? 'heal' : (eff.effect?.attack ? 'attack_boost' : (eff.effect?.defense ? 'defense_boost' : 'consumable')))
                ),
                description: '활성화된 효과'
            };
        }

        return {
            id: player.id,
            name: this.anonymizeName(player.name),
            characterImage: player.characterImage,
            hp: player.hp,
            maxHp: player.maxHp,
            attack: player.attack,
            defense: player.defense,
            agility: player.agility,
            isAlive: player.status !== 'dead',
            activeEffects: effects,
            position: player.position
        };
    }

    getGenericEffectName(effectType) {
        const genericNames = {
            'attack_boost': '공격력 증가',
            'defense_boost': '방어력 증가',
            'agility_boost': '민첩성 증가',
            'heal': '회복',
            'booster': '능력치 증가',
            'consumable': '일시적 효과',
            'unknown': '알 수 없는 효과'
        };
        return genericNames[effectType] || '알 수 없는 효과';
        }

    filterLogTextForSpectators(text) {
        // 아이템명, 보정기/물약 등의 구체 명칭을 일반화
        // (한글/영문/숫자 공백 + 보정기|물약|아이템) 패턴을 '아이템'으로 치환
        return (text || '').replace(/[가-힣\w\s]*(?:보정기|물약|아이템)/g, '아이템');
    }

    filterLogForSpectators(log) {
        // 기존 로그는 { timestamp, message } 형태
        return {
            timestamp: log.timestamp,
            message: this.filterLogTextForSpectators(log.message)
        };
    }

    filterActionResultForSpectators(result) {
        if (result?.type === 'use_item') {
            return {
                ...result,
                item: { name: '아이템', type: 'hidden' },
                message: `${result.attacker || result.user || '플레이어'}이(가) 아이템을 사용했습니다.`
            };
        }
        // 공격/방어/회피 등은 그대로 전달(민감정보 없음)
        return result;
    }

    anonymizeName(name) {
        if (!name) return '플레이어';
        // 관전자 뷰에서는 이름 일부 마스킹 (예: 'Casiel' -> 'C****l')
        if (name.length <= 2) return name[0] + '*';
        return name[0] + '*'.repeat(Math.max(1, name.length - 2)) + name[name.length - 1];
    }

    // ====== 관전자용 배틀 목록/권한 ======
    getPublicBattles() {
        const publicBattles = [];
        for (const [battleId, battle] of this.battles.entries()) {
            if (!battle.settings?.private) {
                publicBattles.push({
                    id: battle.id,
                    mode: battle.mode,
                    status: battle.status,
                    playerCount: this.getPlayerCount(battle),
                    spectatorCount: battle.spectators?.size || 0,
                    createdAt: battle.createdAt,
                    startedAt: battle.startedAt,
                    teams: {
                        team1: { name: battle.teamNames?.team1 || '팀1', playerCount: battle.teams.team1.length },
                        team2: { name: battle.teamNames?.team2 || '팀2', playerCount: battle.teams.team2.length }
                    }
                });
            }
        }
        return publicBattles.sort((a, b) => b.createdAt - a.createdAt);
    }

    getPlayerCount(battle) {
        return battle.teams.team1.length + battle.teams.team2.length;
    }

    canSpectate(battleId, spectatorInfo) {
        const battle = this.getBattle(battleId);
        if (!battle) return false;

        // 밴 여부
        if (battle.bannedSpectators?.has(spectatorInfo.id)) return false;

        // 비공개 + 초대 필요
        if (battle.settings?.private || battle.settings?.requireInvite) {
            const invited = battle.invitedSpectators?.includes(spectatorInfo.id);
            if (!invited) return false;
        }

        // 인원 제한
        if (battle.settings?.maxSpectators && (battle.spectators?.size || 0) >= battle.settings.maxSpectators) {
            return false;
        }
        return true;
    }

    generateSpectatorInvite(battleId, adminId) {
        const battle = this.getBattle(battleId);
        if (!battle) return null;
        const isAdmin = battle.teams.team1.some(p => p.id === adminId) || battle.teams.team2.some(p => p.id === adminId);
        if (!isAdmin) return null;

        const inviteToken = uuidv4();
        battle.spectatorInvites.set(inviteToken, {
            createdBy: adminId,
            createdAt: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000),
            used: false
        });
        return {
            token: inviteToken,
            url: `/watch/${battleId}?invite=${inviteToken}`,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)
        };
    }

    validateSpectatorInvite(battleId, inviteToken) {
        const battle = this.getBattle(battleId);
        if (!battle || !battle.spectatorInvites) return false;
        const invite = battle.spectatorInvites.get(inviteToken);
        if (!invite) return false;
        if (invite.expiresAt < Date.now()) {
            battle.spectatorInvites.delete(inviteToken);
            return false;
        }
        return true;
    }

    banSpectator(battleId, spectatorId, adminId) {
        const battle = this.getBattle(battleId);
        if (!battle) return false;
        const isAdmin = battle.teams.team1.some(p => p.id === adminId) || battle.teams.team2.some(p => p.id === adminId);
        if (!isAdmin) return false;

        battle.bannedSpectators.add(spectatorId);

        if (battle.spectators?.has(spectatorId)) {
            battle.spectators.delete(spectatorId);
            if (this.spectatorHandler) {
                this.spectatorHandler.notifySpectatorBan(spectatorId, battleId);
            }
        }
        return true;
    }

    unbanSpectator(battleId, spectatorId, adminId) {
        const battle = this.getBattle(battleId);
        if (!battle) return false;
        const isAdmin = battle.teams.team1.some(p => p.id === adminId) || battle.teams.team2.some(p => p.id === adminId);
        if (!isAdmin) return false;
        battle.bannedSpectators.delete(spectatorId);
        return true;
    }

    isSpectatorBanned(battleId, spectatorId) {
        const battle = this.getBattle(battleId);
        return battle?.bannedSpectators?.has(spectatorId) || false;
    }

    enableSpectatorNotifications(battleId, notifications = {}) {
        const battle = this.getBattle(battleId);
        if (!battle) return false;
        battle.spectatorNotifications = {
            onPlayerAction: notifications.onPlayerAction !== false,
            onTurnChange: notifications.onTurnChange !== false,
            onBattleEvents: notifications.onBattleEvents !== false,
            onChatMessages: notifications.onChatMessages !== false
        };
        return true;
    }

    updateSpectatorSettings(battleId, settings) {
        const battle = this.getBattle(battleId);
        if (!battle) return false;
        if (!battle.spectatorSettings) battle.spectatorSettings = {};

        Object.assign(battle.spectatorSettings, {
            allowChat: settings.allowChat !== false,
            showPlayerStats: settings.showPlayerStats !== false,
            showDetailedLogs: settings.showDetailedLogs !== false,
            maxSpectators: settings.maxSpectators || battle.settings.maxSpectators || 50,
            requireInvite: settings.requireInvite || battle.settings.requireInvite || false
        });
        return true;
    }

    logSpectatorActivity(battleId, spectatorId, activity) {
        const battle = this.getBattle(battleId);
        if (!battle) return;
        if (!battle.spectatorLogs) battle.spectatorLogs = [];
        battle.spectatorLogs.push({ spectatorId, activity, timestamp: Date.now() });
        if (battle.spectatorLogs.length > 1000) {
            battle.spectatorLogs = battle.spectatorLogs.slice(-500);
        }
    }

    getSpectatorStats() {
        if (!this.spectatorHandler) {
            const counts = {};
            let total = 0;
            for (const [id, b] of this.battles.entries()) {
                const c = b.spectators?.size || 0;
                counts[id] = c;
                total += c;
            }
            const activeBattles = Array.from(this.battles.values()).filter(b => b.status === 'in_progress').length;
            return {
                totalSpectators: total,
                battleSpectatorCounts: counts,
                averageSpectatorsPerBattle: this.battles.size ? total / this.battles.size : 0,
                activeBattles
            };
        }
        return this.spectatorHandler.getStats();
    }

    getBattleSpectators(battleId) {
        if (!this.spectatorHandler) return [];
        return this.spectatorHandler.getSpectatorsByBattleId(battleId);
    }

    getDetailedSpectatorStats(battleId = null) {
        const stats = {
            totalSpectators: 0,
            activeBattles: 0,
            spectatorsByBattle: {},
            averageViewTime: 0,
            peakSpectators: 0,
            spectatorActivities: []
        };

        if (battleId) {
            const battle = this.getBattle(battleId);
            if (battle) {
                stats.battleId = battleId;
                stats.currentSpectators = battle.spectators?.size || 0;
                stats.spectatorLogs = battle.spectatorLogs || [];
                stats.bannedSpectators = battle.bannedSpectators?.size || 0;
            }
        } else {
            for (const [id, battle] of this.battles.entries()) {
                const c = battle.spectators?.size || 0;
                stats.totalSpectators += c;
                stats.spectatorsByBattle[id] = c;
                if (battle.status === 'in_progress') stats.activeBattles++;
            }
        }
        return stats;
    }

    // ===== 상태 변경 헬퍼(관전자 알림 포함) =====
    updateBattleStatus(battleId, newStatus) {
        const battle = this.getBattle(battleId);
        if (!battle) return;
        battle.status = newStatus;
        this.notifySpectators(battleId, 'battle_updated', {
            battle: this.getSpectatorSafeBattleState(battleId),
            statusChanged: true,
            newStatus
        });
    }

    finishBattle(battleId, winner) {
        const battle = this.getBattle(battleId);
        if (!battle) return;
        battle.status = 'finished';
        battle.winner = winner;
        battle.finishedAt = Date.now();
        this.notifySpectators(battleId, 'battle_finished', {
            winner,
            battle: this.getSpectatorSafeBattleState(battleId)
        });
    }
}

module.exports = BattleEngine;
