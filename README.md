
# 고정 룰(변경 금지)

* 스탯 범위: `attack/defense/agility/luck`는 **각 1\~5**, 총합 제한 없음.
* 최대 HP: **100**(모든 회복/피해는 0\~100 사이로 클램프).
* 크리티컬: **d20 ≥ (20 - luck/2)** 이면 크리티컬, **최종 대미지 ×2**.
* 아이템:

  * **디터니**: 사용 시 **HP +10**(MAX\_HP까지).
  * **공격/방어 보정기**: **성공 확률 10%**, 성공 시 해당 스탯 **×2배(해당 턴 1회)**, 실패 시 ×1.
  * 공격 보정기는 “공격자” 계산에만, 방어 보정기는 “방어자” 계산에만 적용.
* 최소 대미지 규칙: **전면 폐지**(어디에도 “하한 1” 적용하지 않음).
* 회피(Dodge): **성공 시 대미지 0**. (완전 무효화)
* 방어(Defend): **역공격 없음**(카운터 삭제). “단순 방어”만.

# 세부 계산식(고정)

* d20: `1~20` 균등 난수.
* 공격자 최종 공격수치:

  ```
  atkStat = floor(attack × (보정기 성공 ? 2 : 1))
  attackScore = atkStat + d20
  isCrit = (d20 ≥ 20 - luck/2)
  ```
* 방어자 방어치:

  ```
  defenseValue = floor(defense × (보정기 성공 ? 2 : 1))
  ```
* 방어(Defend) 해석:

  ```
  damage = max(0, attackScore - defenseValue)
  if (isCrit) damage *= 2
  // 역공격(카운터) 없음
  ```
* 회피(Dodge) 해석:

  ```
  dodgeScore = agility + d20
  if (dodgeScore ≥ attackScore) -> damage = 0
  else {
    damage = attackScore
    if (isCrit) damage *= 2
    // 하한 1 없음
  }
  ```
* HP 반영:

  ```
  hp = clamp(hp - damage, 0, 100)
  hp = clamp(hp + heal,   0, 100)  // 디터니 등
  ```

# 용어/표기(고정)

* 팀 표기: 내부 키 `phoenix/eaters` ↔ UI 표기 **A팀/B팀**으로 통일.
* 주사위/확률/배수 외에는 추가 보정/페널티 없음(명중 판정은 선택 기능로만 유지 가능).

원하면 이 규격 그대로 `/assets/js/common-battle-rules.js`에 맞춰 체크리스트/테스트 케이스도 바로 뽑아줄게.
