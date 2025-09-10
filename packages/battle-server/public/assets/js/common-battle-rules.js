// PYXIS 전투 룰 계산 함수 (플레이어/관전자/관리자 공통 사용 가능)

function calcAttack(player, target) {
  // 공격력 + 주사위(1~20) - 상대 방어력
  const dice = rollDice();
  const attack = player.atk + dice - target.def;
  return Math.max(0, attack);
}

function calcHit(player) {
  // 행운 + 주사위(1~20)
  return player.luk + rollDice();
}

function calcDodge(player) {
  // 민첩 + 주사위(1~20)
  return player.dex + rollDice();
}

function isCritical(player) {
  // 주사위(1~20) ≥ (20 - 행운/2)
  const dice = rollDice();
  return dice >= (20 - player.luk / 2);
}

function calcDefense(player, attacker) {
  // 민첩 + 주사위(1~20) - 상대 공격수치
  return player.dex + rollDice() - attacker.atk;
}

function calcDamage(attacker, defender) {
  // 방어력 - 상대 공격력 = 남은 수만큼 대미지
  return Math.max(0, attacker.atk - defender.def);
}

function isDodgeSuccess(player, attacker) {
  // 민첩 + 주사위(1~20) ≥ 상대 공격수치
  return (player.dex + rollDice()) >= attacker.atk;
}

function useAtkItem(player) {
  // 공격력 ×1.5, 성공확률 10%
  if (Math.random() < 0.1) return player.atk * 1.5;
  return player.atk;
}
function useDefItem(player) {
  // 방어력 ×1.5, 성공확률 10%
  if (Math.random() < 0.1) return player.def * 1.5;
  return player.def;
}
function useHealItem(player) {
  // HP 10 고정 회복
  player.hp = Math.min(player.maxHp, player.hp + 10);
}

function rollDice() {
  return Math.floor(Math.random() * 20) + 1;
}
