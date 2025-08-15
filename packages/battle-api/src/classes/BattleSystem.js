import { BATTLE_MESSAGES } from './constants.js';

export class BattleSystem {
  constructor(player, enemy) {
    this.player = player;
    this.enemy = enemy;
    this.battleLog = [];
    this.currentTurn = 1;
    this.isPlayerTurn = true;
  }

  // 전투 시작
  startBattle() {
    this.battleLog = [];
    this.currentTurn = 1;
    this.isPlayerTurn = true;
    this.addToBattleLog(BATTLE_MESSAGES.BATTLE_START);
    return this.getBattleState();
  }

  // 전투 로그에 메시지 추가
  addToBattleLog(message) {
    this.battleLog.push({
      turn: this.currentTurn,
      message: message,
      timestamp: Date.now()
    });
  }

  // 공격 실행
  executeAttack(attacker, defender) {
    const hitResult = attacker.rollToHit(defender);
    const attackerName = attacker.name;
    const defenderName = defender.name;

    // 명중 실패
    if (!hitResult.hit) {
      this.addToBattleLog(`${attackerName}의 공격! (굴린 값: ${hitResult.roll} vs 방어: ${hitResult.defense})`);
      this.addToBattleLog(BATTLE_MESSAGES.MISS);
      return {
        hit: false,
        damage: 0,
        critical: false,
        roll: hitResult.roll
      };
    }

    // 명중 성공 - 크리티컬 판정
    const roll = hitResult.roll - attacker.stats.agility; // 순수 주사위 값
    const isCritical = attacker.isCritical(roll);
    const damage = attacker.calculateDamage(isCritical);
    const actualDamage = defender.takeDamage(damage);

    this.addToBattleLog(`${attackerName}의 공격! (굴린 값: ${hitResult.roll} vs 방어: ${hitResult.defense})`);
    if (isCritical) {
      this.addToBattleLog(BATTLE_MESSAGES.CRITICAL);
    }
    this.addToBattleLog(`${defenderName}에게 ${actualDamage} 데미지! (HP: ${defender.hp}/${defender.maxHp})`);

    return {
      hit: true,
      damage: actualDamage,
      critical: isCritical,
      roll: hitResult.roll
    };
  }

  // 플레이어 턴 처리
  playerAttack() {
    if (!this.isPlayerTurn || this.isBattleOver()) {
      return this.getBattleState();
    }

    const result = this.executeAttack(this.player, this.enemy);
    
    if (!this.enemy.isAlive()) {
      this.addToBattleLog(BATTLE_MESSAGES.VICTORY);
    } else {
      this.isPlayerTurn = false;
      // 적 턴은 자동으로 실행
      setTimeout(() => this.enemyTurn(), 1000);
    }

    return this.getBattleState();
  }

  // 적 턴 처리
  enemyTurn() {
    if (this.isPlayerTurn || this.isBattleOver()) {
      return;
    }

    const result = this.executeAttack(this.enemy, this.player);
    
    if (!this.player.isAlive()) {
      this.addToBattleLog(BATTLE_MESSAGES.DEFEAT);
    } else {
      this.currentTurn++;
      this.isPlayerTurn = true;
    }

    return this.getBattleState();
  }

  // 전투 종료 여부 확인
  isBattleOver() {
    return !this.player.isAlive() || !this.enemy.isAlive();
  }

  // 승자 반환
  getWinner() {
    if (!this.isBattleOver()) return null;
    return this.player.isAlive() ? this.player : this.enemy;
  }

  // 현재 전투 상태 반환
  getBattleState() {
    return {
      player: this.player.getInfo(),
      enemy: this.enemy.getInfo(),
      battleLog: [...this.battleLog],
      currentTurn: this.currentTurn,
      isPlayerTurn: this.isPlayerTurn,
      isOver: this.isBattleOver(),
      winner: this.getWinner()?.name || null
    };
  }

  // 전투 초기화
  resetBattle() {
    this.player.reset();
    this.enemy.reset();
    this.battleLog = [];
    this.currentTurn = 1;
    this.isPlayerTurn = true;
  }
}
