import { useState, useCallback, useRef } from 'react';

export const useBattle = () => {
  const [battleState, setBattleState] = useState({
    player: {
      id: 'player',
      name: 'Player',
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      attack: 20,
      defense: 10,
      speed: 15
    },
    enemy: {
      id: 'enemy',
      name: 'Goblin',
      hp: 80,
      maxHp: 80,
      mp: 30,
      maxMp: 30,
      attack: 15,
      defense: 5,
      speed: 12
    },
    turn: 'player',
    round: 1,
    battleLog: [],
    isGameOver: false,
    winner: null
  });

  const logRef = useRef([]);

  const addLog = useCallback((message) => {
    const timestamp = Date.now();
    const logEntry = {
      id: timestamp,
      message,
      timestamp
    };
    
    logRef.current = [...logRef.current, logEntry];
    setBattleState(prev => ({
      ...prev,
      battleLog: logRef.current
    }));
  }, []);

  const attack = useCallback((attackerId, targetId) => {
    setBattleState(prev => {
      const attacker = prev[attackerId];
      const target = prev[targetId];
      
      // 간단한 데미지 계산
      const baseDamage = Math.floor(Math.random() * attacker.attack) + 1;
      const damage = Math.max(1, baseDamage - target.defense);
      
      const newHp = Math.max(0, target.hp - damage);
      const isKilled = newHp === 0;
      
      addLog(`${attacker.name}이(가) ${target.name}에게 ${damage} 데미지를 입혔습니다!`);
      
      if (isKilled) {
        addLog(`${target.name}이(가) 쓰러졌습니다!`);
      }

      return {
        ...prev,
        [targetId]: {
          ...target,
          hp: newHp
        },
        turn: prev.turn === 'player' ? 'enemy' : 'player',
        isGameOver: isKilled,
        winner: isKilled ? attackerId : null
      };
    });
  }, [addLog]);

  const defend = useCallback((defenderId) => {
    setBattleState(prev => {
      const defender = prev[defenderId];
      addLog(`${defender.name}이(가) 방어 태세를 취했습니다!`);
      
      return {
        ...prev,
        turn: prev.turn === 'player' ? 'enemy' : 'player'
      };
    });
  }, [addLog]);

  const resetBattle = useCallback(() => {
    setBattleState({
      player: {
        id: 'player',
        name: 'Player',
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        attack: 20,
        defense: 10,
        speed: 15
      },
      enemy: {
        id: 'enemy',
        name: 'Goblin',
        hp: 80,
        maxHp: 80,
        mp: 30,
        maxMp: 30,
        attack: 15,
        defense: 5,
        speed: 12
      },
      turn: 'player',
      round: 1,
      battleLog: [],
      isGameOver: false,
      winner: null
    });
    logRef.current = [];
  }, []);

  return {
    battleState,
    actions: {
      attack,
      defend,
      resetBattle
    }
  };
};