import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../src/engine/map.ts';
import { findRoute } from '../src/engine/planner.ts';
import { SimulationEngine } from '../src/engine/simulation.ts';
import { isRoadBlocked, roadBaseMinutes } from '../src/engine/travel.ts';

function freshWorld(seed = 1001) {
  const world = generateWorld(seed);
  const capital = world.stations.find((s) => s.isCapital)!;
  const frontier = world.stations.find((s) => s.isFrontier)!;
  return { world, capital, frontier };
}

test('规划:Dijkstra 找到京城→边关路径,且道路全部当前畅通', () => {
  const { world, capital, frontier } = freshWorld();
  const path = findRoute(world, capital.id, frontier.id, 0, 1);
  assert.ok(path && path.length >= 2);
  assert.equal(path[0], capital.id);
  assert.equal(path[path.length - 1], frontier.id);
  for (let i = 0; i < path.length - 1; i++) {
    const edge0: { roadId: number; other: number } = world.adjacency
      .get(path[i])!
      .find((e) => e.other === path[i + 1])!;
    assert.equal(isRoadBlocked(world.roads[edge0.roadId], 0), false);
  }
});

test('规划:断路后自动绕路,绝不使用被封道路', () => {
  const { world, capital, frontier } = freshWorld();
  const pathBefore = findRoute(world, capital.id, frontier.id, 0, 1)!;
  // 封掉规划路径上的第一条路
  const firstEdge = world.adjacency.get(pathBefore[0])!.find((e) => e.other === pathBefore[1])!;
  world.roads[firstEdge.roadId].blockedUntil = 999999;
  const pathAfter = findRoute(world, capital.id, frontier.id, 0, 1)!;
  assert.notDeepEqual(pathAfter, pathBefore);
  for (let i = 0; i < pathAfter.length - 1; i++) {
    const edge2: { roadId: number; other: number } = world.adjacency
      .get(pathAfter[i])!
      .find((e) => e.other === pathAfter[i + 1])!;
    assert.notEqual(edge2.roadId, firstEdge.roadId);
  }
});

test('规划:派单后锁定首程马与驿卒,其它公文不会重复占用', () => {
  const { world, capital, frontier } = freshWorld();
  const engine = new SimulationEngine(world, 1);
  const doc1 = engine.spawn(capital.id, frontier.id, 1);
  const ok1 = engine.replanDocument(doc1);
  assert.equal(ok1, true);
  const leg1 = doc1.legs[0];
  assert.equal(world.horses[leg1.horseId].documentId, doc1.id);
  assert.equal(world.couriers[leg1.courierId].documentId, doc1.id);

  const doc2 = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc2);
  const leg2 = doc2.legs[0];
  assert.notEqual(leg2.horseId, leg1.horseId);
  assert.notEqual(leg2.courierId, leg1.courierId);
});

test('规划:一等加急全程 ETA 不超过 3 个游戏日', () => {
  const { world, capital, frontier } = freshWorld();
  const engine = new SimulationEngine(world, 2);
  const doc = engine.spawn(capital.id, frontier.id, 1);
  const ok = engine.replanDocument(doc);
  assert.equal(ok, true);
  const totalEta = doc.legs[doc.legs.length - 1].eta;
  assert.ok(totalEta <= world.config.urgency[1].deadlineMinutes, `ETA=${totalEta}`);
});

test('规划:全图道路被封到无可达路径时返回不可行而非崩溃', () => {
  const { world, capital, frontier } = freshWorld();
  // 封掉京城所有出路
  for (const { roadId } of world.adjacency.get(capital.id)!) {
    world.roads[roadId].blockedUntil = 999999;
  }
  const path = findRoute(world, capital.id, frontier.id, 0, 1);
  assert.equal(path, null);
  const engine = new SimulationEngine(world, 3);
  const doc = engine.spawn(capital.id, frontier.id, 1);
  const ok = engine.replanDocument(doc);
  assert.equal(ok, false);
  assert.equal(doc.status, 'queued');
});

test('规划:紧急等级越高道路权重越低(加急走得更快)', () => {
  const { world } = freshWorld();
  const road = world.roads[0];
  const t1 = roadBaseMinutes(road, 1, world.config);
  const t3 = roadBaseMinutes(road, 3, world.config);
  assert.ok(t1 < t3);
});
