import React, { useState, useEffect } from 'react';
import { Character } from '../classes/Character';
import { BattleSystem } from '../classes/BattleSystem';
import { STAT_INFO, GAME_CONFIG } from '../utils/constants';
import { 
  validateStats, 
  generateRandomStats, 
  createEnemy, 
  canAllocateStat, 
  getHpPercentage, 
  getHpColor,
  getTotalStats 
} from '../utils/gameUtils';

const Game = () => {
  const [gameState, setGameState] = useState('setup'); // setup, battle, result
  const [playerStats, setPlayerStats] = useState({
    attack: 3,
    defense: 3,
    agility: 3,
    luck: 3
  });
  const [playerName, setPlayerName] = useState('플레이어');
  const [player, setPlayer] = useState(null);
  const [enemy, setEnemy] = useState(null);
  const [battleSystem, setBattleSystem] = useState(null);
  const [battleState, setBattleState] = useState(null);
  const [difficulty, setDifficulty] = useState('normal');

  // 스탯 조정
  const adjustStat = (statName, increment) => {
    if (!canAllocateStat(playerStats, statName, increment)) return;
    
    setPlayerStats(prev => ({
      ...prev,
      [statName]: prev[statName] + increment
    }));
  };

  // 랜덤 스탯 생성
  const randomizeStats = () => {
    setPlayerStats(generateRandomStats());
  };

  // 게임 시작
  const startGame = () => {
    const validation = validateStats(playerStats);
    if (!validation.isValid) {
      alert(`스탯 포인트를 모두 사용해주세요! (현재: ${validation.totalPoints}/${validation.maxPoints})`);
      return;
    }

    const newPlayer = new Character(playerName, playerStats);
    const newEnemy = createEnemy(difficulty);
    const newBattleSystem = new BattleSystem(newPlayer, newEnemy);

    setPlayer(newPlayer);
    setEnemy(newEnemy);
    setBattleSystem(newBattleSystem);
    setBattleState(newBattleSystem.startBattle());
    setGameState('battle');
  };

  // 공격 실행
  const attack = () => {
    if (!battleSystem || !battleState.isPlayerTurn || battleState.isOver) return;
    
    const newState = battleSystem.playerAttack();
    setBattleState(newState);
  };

  // 적 턴 처리
  useEffect(() => {
    if (battleState && !battleState.isPlayerTurn && !battleState.isOver) {
      const timer = setTimeout(() => {
        const newState = battleSystem.enemyTurn();
        setBattleState(newState);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [battleState, battleSystem]);

  // 새 게임
  const newGame = () => {
    setGameState('setup');
    setPlayer(null);
    setEnemy(null);
    setBattleSystem(null);
    setBattleState(null);
  };

  // 다시 전투
  const rematch = () => {
    if (battleSystem) {
      battleSystem.resetBattle();
      setBattleState(battleSystem.startBattle());
    }
  };

  const remainingPoints = GAME_CONFIG.STAT_POINTS - getTotalStats(playerStats);

  if (gameState === 'setup') {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-gray-900 text-white min-h-screen">
        <h1 className="text-3xl font-bold text-center mb-8 text-blue-400">D20 전투 게임</h1>
        
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">캐릭터 생성</h2>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">캐릭터 이름:</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full p-2 bg-gray-700 border border-gray-600 rounded focus:border-blue-400"
              placeholder="캐릭터 이름을 입력하세요"
            />
          </div>

          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-medium">스탯 분배</h3>
              <div className="text-sm">
                남은 포인트: <span className={remainingPoints === 0 ? 'text-green-400' : 'text-yellow-400'}>{remainingPoints}</span>
              </div>
            </div>
            
            {Object.entries(STAT_INFO).map(([key, info]) => (
              <div key={key} className="flex items-center justify-between mb-3 p-3 bg-gray-700 rounded">
                <div>
                  <span className={`font-medium ${info.color}`}>{info.name}</span>
                  <div className="text-xs text-gray-400">{info.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustStat(key, -1)}
                    disabled={!canAllocateStat(playerStats, key, -1)}
                    className="w-8 h-8 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-bold"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-bold">{playerStats[key]}</span>
                  <button
                    onClick={() => adjustStat(key, 1)}
                    disabled={!canAllocateStat(playerStats, key, 1)}
                    className="w-8 h-8 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">난이도:</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full p-2 bg-gray-700 border border-gray-600 rounded focus:border-blue-400"
            >
              <option value="easy">쉬움</option>
              <option value="normal">보통</option>
              <option value="hard">어려움</option>
              <option value="boss">보스</option>
            </select>
          </div>

          <div className="flex gap-3">
            <button
              onClick={randomizeStats}
              className="flex-1 bg-purple-600 hover:bg-purple-700 py-2 px-4 rounded font-medium"
            >
              랜덤 생성
            </button>
            <button
              onClick={startGame}
              disabled={remainingPoints !== 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-2 px-4 rounded font-medium"
            >
              게임 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'battle' && battleState) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-gray-900 text-white min-h-screen">
        <h1 className="text-2xl font-bold text-center mb-6 text-red-400">전투 중</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* 플레이어 정보 */}
          <div className="bg-green-800 rounded-lg p-4">
            <h3 className="text-lg font-bold mb-3">{battleState.player.name}</h3>
            <div className="mb-2">
              <div className="flex justify-between text-sm">
                <span>HP</span>
                <span>{battleState.player.hp}/{battleState.player.maxHp}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${getHpColor(getHpPercentage(battleState.player.hp, battleState.player.maxHp))}`}
                  style={{ width: `${getHpPercentage(battleState.player.hp, battleState.player.maxHp)}%` }}
                ></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(STAT_INFO).map(([key, info]) => (
                <div key={key}>
                  <span className={info.color}>{info.name}</span>: {battleState.player.stats[key]}
                </div>
              ))}
            </div>
          </div>

          {/* 적 정보 */}
          <div className="bg-red-800 rounded-lg p-4">
            <h3 className="text-lg font-bold mb-3">{battleState.enemy.name}</h3>
            <div className="mb-2">
              <div className="flex justify-between text-sm">
                <span>HP</span>
                <span>{battleState.enemy.hp}/{battleState.enemy.maxHp}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${getHpColor(getHpPercentage(battleState.enemy.hp, battleState.enemy.maxHp))}`}
                  style={{ width: `${getHpPercentage(battleState.enemy.hp, battleState.enemy.maxHp)}%` }}
                ></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(STAT_INFO).map(([key, info]) => (
                <div key={key}>
                  <span className={info.color}>{info.name}</span>: {battleState.enemy.stats[key]}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 전투 컨트롤 */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="text-center">
            {battleState.isOver ? (
              <div>
                <h2 className="text-xl font-bold mb-4 text-yellow-400">
                  {battleState.winner === playerName ? '승리!' : '패배!'}
                </h2>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={rematch}
                    className="bg-orange-600 hover:bg-orange-700 py-2 px-6 rounded font-medium"
                  >
                    다시 전투
                  </button>
                  <button
                    onClick={newGame}
                    className="bg-blue-600 hover:bg-blue-700 py-2 px-6 rounded font-medium"
                  >
                    새 게임
                  </button>
                </div>
              </div>
            ) : battleState.isPlayerTurn ? (
              <button
                onClick={attack}
                className="bg-red-600 hover:bg-red-700 py-3 px-8 rounded-lg font-bold text-lg"
              >
                공격!
              </button>
            ) : (
              <div className="text-yellow-400 font-medium">적의 턴...</div>
            )}
          </div>
        </div>

        {/* 전투 로그 */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-bold mb-3">전투 기록</h3>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {battleState.battleLog.map((log, index) => (
              <div key={index} className="text-sm py-1 border-b border-gray-700 last:border-b-0">
                <span className="text-gray-400">[턴 {log.turn}]</span> {log.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default Game;
