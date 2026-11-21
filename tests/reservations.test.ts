import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../src/engine/map.ts';
import { SimulationEngine } from '../src/engine/simulation.ts';
import { addReservation, hasConflict, removeDocumentReservations } from '../src/engine/reservations.ts';

function countOverlaps(map: Map<number, Array<{ start: number; end: number }>>): number {
  let conflicts = 0;
  for (const arr of map.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[i].start < arr[j].end && arr[j].start < arr[i].end) conflicts++;
      }
    }
  }
  return conflicts;
}

test('预约:同一资源不同时间窗可共存,重叠窗判冲突', () => {
  const world = generateWorld(1);
  assert.equal(hasConflict(world, 'horse', 0, 100, 200), false);
  addReservation(world, 'horse', 0, { documentId: 1, start: 100, end: 200 });
  assert.equal(hasConflict(world, 'horse', 0, 200, 300), false); // 首尾相接不冲突
  addReservation(world, 'horse', 0, { documentId: 2, start: 200, end: 300 });
  assert.equal(hasConflict(world, 'horse', 0, 150, 250), true); // 真重叠
  assert.equal(hasConflict(world, 'horse', 1, 100, 200), false); // 别的马不冲突
});

test('预约:删除公文预约后时间窗重新可用', () => {
  const world = generateWorld(1);
  addReservation(world, 'courier', 5, { documentId: 7, start: 100, end: 400 });
  assert.equal(hasConflict(world, 'courier', 5, 200, 300), true);
  removeDocumentReservations(world, 7);
  assert.equal(hasConflict(world, 'courier', 5, 200, 300), false);
});

test('预约:多单全程规划后无任何资源时间窗冲突', () => {
  const world = generateWorld(20261122);
  const engine = new SimulationEngine(world, 20261122);
  const cap = world.stations.find((s) => s.isCapital)!;
  const fr = world.stations.find((s) => s.isFrontier)!;
  for (let i = 0; i < 30; i++) {
    const d = engine.spawn(cap.id, fr.id, (i % 3) + 1 as 1 | 2 | 3);
    engine.replanDocument(d);
  }
  assert.equal(countOverlaps(world.horseReservations), 0);
  assert.equal(countOverlaps(world.courierReservations), 0);
});

test('预约:重规划幂等,不产生重复或残留预约', () => {
  const world = generateWorld(20261122);
  const engine = new SimulationEngine(world, 20261122);
  const cap = world.stations.find((s) => s.isCapital)!;
  const fr = world.stations.find((s) => s.isFrontier)!;
  const d = engine.spawn(cap.id, fr.id, 1);
  engine.replanDocument(d);
  const before = [...world.horseReservations.values()].reduce((a, b) => a + b.length, 0);
  // 同一单连续重规划多次
  engine.replanAll();
  engine.replanAll();
  const after = [...world.horseReservations.values()].reduce((a, b) => a + b.length, 0);
  assert.equal(after, before, '重规划不应累积预约');
  // 所有预约都属于当前在途公文
  for (const arr of world.horseReservations.values()) {
    for (const r of arr) assert.ok(r.documentId === d.id);
  }
});
