// packages/battle-server/src/engine/BattleEngine.js
import { resolveAttack, useItem } from "./rules.js";
import { alive, decideFirstTeam, initTurn, advance, updateCurrentPlayer, judgeWinner } from "./turns.js";

export class BattleEngine {
  /**
   * @param {object} battle - 서버가 관리하는 배틀 스냅샷 객체 (참조로 유지)
   * @param {(type:string, message:string, data?:object)=>void} log - 로그 푸시 콜백
   * @param {()=>void} notify - 전송 콜백 (battleUpdate)
   */
  constructor(battle, log, notify) {
    this.battle = battle;
    this.log = log;
    this.notify = notify;

    // 팀 제한 시간(페이즈) 5분
    this.PHASE_LIMIT_MS = 5 * 60 * 1000;
  }

  updateTimeLeft() {
    const b = this.battle;
    if (b.status !== "active" || !b.turn?.phaseStartedAt) {
      b.timeLeft = null; return;
    }
    const remain = Math.max(0, Math.floor((this.PHASE_LIMIT_MS - (Date.now() - b.turn.phaseStartedAt)) / 1000));
    b.timeLeft = remain;
  }

  startBattle() {
    const b = this.battle;
    if (!b || b.status === "ended") return false;
    if ((b.players || []).length === 0) return false;

    const first = decideFirstTeam(b.players);
    initTurn(b, first);
    b.status = "active";
    this.log("admin", `전투 시작 (선공: ${first}팀)`);
    this.notify();
    return true;
  }

  /** 현재 차례인지 검사 */
  _isPlayersTurn(playerId) {
    const cur = this.battle.currentTurn?.currentPlayer;
    return !!(cur && cur.id === playerId);
  }

  /** 팀 제한시간 초과 자동 패스 */
  _autoPassIfNeeded() {
    const b = this.battle;
    if (b.status !== "active") return false;
    const elapsed = Date.now() - (b.turn?.phaseStartedAt || Date.now());
    if (elapsed >= this.PHASE_LIMIT_MS) {
      const curName = b.currentTurn?.currentPlayer?.name || "";
      this.log("system", `팀 제한시간 초과: ${b.currentTurn?.currentTeam}팀 → ${curName ? curName + " 자동 패스" : "자동 진행"}`);
      advance(b);
      this.notify();
      return true;
    }
    return false;
  }

  /** 공용: 라운드/승리 판정 */
  _postActionHouseKeeping(actorTeam) {
    const b = this.battle;
    // 마지막 공격 팀 기록
    b.turn.lastActorTeam = actorTeam || b.currentTurn?.currentTeam || null;

    // 즉시 승리 체크
    let winner = judgeWinner(b);
    if (winner) {
      b.status = "ended";
      this.log("system", `전투 종료: ${winner}팀 승리`);
      this.notify();
      return;
    }
    // 다음 순서
    advance(b);

    // 라운드 종료·교대 상황을 로그로
    this.log("system",
      `턴 진행: 라운드 ${b.turn.round} / 현재팀 ${b.currentTurn?.currentTeam || "-"}` );

    // 제한시간 갱신
    this.updateTimeLeft();
    this.notify();
  }

  /** 액션 적용 */
  applyAction(playerId, action) {
    const b = this.battle;
    if (!b || b.status !== "active") return { error: "inactive_battle" };

    // 자동 패스(5분 초과) 먼저 처리
    if (this._autoPassIfNeeded()) return { ok: true, autoPassed: true };

    const actor = (b.players || []).find(p => p.id === playerId);
    if (!actor) return { error: "player_not_found" };

    if (!this._isPlayersTurn(playerId)) {
      return { error: "not_your_turn" };
    }

    const aType = action?.type;

    // 행동 처리
    if (aType === "attack") {
      const targetId = action?.targetId;
      const target = (b.players || []).find(p => p.id === targetId);
      if (!target || (target.hp || 0) <= 0) return { error: "invalid_target" };

      const res = resolveAttack(actor, target);
      if (res.damage > 0) {
        target.hp = Math.max(0, (target.hp || 0) - res.damage);
      }
      const critText = res.crit ? " (치명타)" : "";
      const evText = res.evaded ? "회피 성공" : `피해 ${res.damage}`;
      this.log("battle", `[공격] ${actor.name} → ${target.name}: ${evText}${critText}`, { damage: res.damage });

      this._postActionHouseKeeping(actor.team);
      return { ok: true, result: res };
    }

    if (aType === "defend") {
      actor.state.defending = true;
      this.log("battle", `[방어] ${actor.name} 방어 태세 돌입`);
      this._postActionHouseKeeping(actor.team);
      return { ok: true };
    }

    if (aType === "dodge") {
      actor.state.dodging = true;
      this.log("battle", `[회피] ${actor.name} 회피 태세 돌입`);
      this._postActionHouseKeeping(actor.team);
      return { ok: true };
    }

    if (aType === "pass") {
      this.log("battle", `[패스] ${actor.name} 행동 건너뜀`);
      this._postActionHouseKeeping(actor.team);
      return { ok: true };
    }

    if (aType === "item") {
      const t = action?.itemType;
      const useRes = useItem(actor, t);
      if (!useRes.ok) return { error: "item_failed", detail: useRes.reason };

      if (useRes.type === "heal") {
        this.log("battle", `[아이템] ${actor.name} 디터니 사용 (+${useRes.amount})`);
        // 아이템 사용도 행동 1회로 간주 → 턴 진행
        this._postActionHouseKeeping(actor.team);
        return { ok: true, heal: useRes.amount };
      }
      if (useRes.type === "atk_boost") {
        this.log("battle", `[아이템] ${actor.name} 공격 보정기 ${useRes.success ? "성공" : "실패"}`);
        this._postActionHouseKeeping(actor.team);
        return { ok: true, atkBoost: useRes.success };
      }
      if (useRes.type === "def_boost") {
        this.log("battle", `[아이템] ${actor.name} 방어 보정기 ${useRes.success ? "성공" : "실패"}`);
        this._postActionHouseKeeping(actor.team);
        return { ok: true, defBoost: useRes.success };
      }
      return { error: "unknown_item" };
    }

    return { error: "unknown_action" };
  }
}
