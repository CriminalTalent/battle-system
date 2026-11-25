import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleStore } from '../src/engine/BattleEngine.js';

function setup() {
  const s = createBattleStore();
  const b = s.create('1v1');
  const A = s.addPlayer(b.id, { name: 'a', team: 'A', stats: { attack: 999 } });
  const B = s.addPlayer(b.id, { name: 'b', team: 'B' });
  s.markReady(b.id, A.id); s.markReady(b.id, B.id);
  return { s, b, A, B };
}

test('스탯 상한, 토큰 비노출', () => {
  const { s, b, A } = setup();
  assert.equal(A.stats.attack, 10);
  assert.equal(A.token, undefined);
  s.markReady(b.id, A.id); s.markReady(b.id, b.players[1].id); s.start(b.id);
  const snap = JSON.stringify(s.snapshot(b.id));
  for (const p of b.players) assert.ok(!snap.includes(p.token));
  s.end(b.id);
});

test('일시정지 후 재개하면 타이머가 이어진다', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { s, b } = setup();
  s.start(b.id);
  const first = b.phase;
  mock.timers.tick(60_000);
  assert.ok(s.pause(b.id));
  mock.timers.tick(600_000);
  assert.equal(b.phase, first);
  assert.ok(s.resume(b.id));
  mock.timers.tick(240_000);
  assert.notEqual(b.phase, first);
  mock.timers.reset();
});

test('아군 공격 거부, 전투가 끝까지 진행되고 승자 기록', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { s, b, A, B } = setup();
  s.start(b.id);
  const cur = b.currentTeam === 'A' ? A : B;
  assert.equal(s.playerAction(b.id, cur.id, { type: 'attack', targetId: cur.id }), null);
  for (let i = 0; i < 500 && b.status === 'active'; i++) {
    if (b.phase.endsWith('_select')) {
      const [me, foe] = b.currentTeam === 'A' ? [A, B] : [B, A];
      s.playerAction(b.id, me.id, { type: 'attack', targetId: foe.id });
    } else mock.timers.tick(5_000);
  }
  assert.equal(b.status, 'ended');
  assert.ok(['A', 'B'].includes(b.winner));
  assert.equal(s.resume(b.id), null);
  mock.timers.reset();
});

test('1시간 제한 종료 시 HP 합산 승자', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { s, b } = setup();
  s.start(b.id);
  b.players.find(p => p.team === 'B').hp = 50;
  b.hardLimitAt = Date.now();
  for (let i = 0; i < 10 && b.status === 'active'; i++) mock.timers.tick(300_000);
  assert.equal(b.status, 'ended');
  assert.equal(b.winner, 'A');
  mock.timers.reset();
});

test('스냅샷에 이번 선택 페이즈의 선택 완료자가 표시된다', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = createBattleStore();
  const b = s.create('2v2');
  const ps = [['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['b2', 'B']].map(([name, team]) => s.addPlayer(b.id, { name, team }));
  for (const p of ps) s.markReady(b.id, p.id);
  s.start(b.id);
  const team = b.currentTeam;
  assert.deepEqual(s.snapshot(b.id).currentTurn.actedIds, []);
  const me = b.turnCursor.playerId;
  s.playerAction(b.id, me, { type: 'pass' });
  const snap = s.snapshot(b.id);
  assert.equal(snap.currentTeam, team);
  assert.deepEqual(snap.currentTurn.actedIds, [me]);
  s.end(b.id);
  mock.timers.reset();
});
