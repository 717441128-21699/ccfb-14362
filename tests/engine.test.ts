import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/engine/config.ts';
import { generateWorld } from '../src/engine/map.ts';
import { buildAdjacency } from '../src/engine/simulation.ts';

test('地图:30 个驿站、路网连通、京城与边关存在', () => {
  const world = generateWorld(20261122);
  assert.equal(world.stations.length, 30);
  assert.equal(world.stations.filter((s) => s.isCapital).length, 1);
  assert.equal(world.stations.filter((s) => s.isFrontier).length, 1);
  assert.ok(world.roads.length >= 35, `道路数应足够多,实际 ${world.roads.length}`);

  // BFS 连通性
  buildAdjacency(world);
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const { other } of world.adjacency.get(cur) ?? []) {
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  assert.equal(seen.size, 30);

  // 每站至少 2 条路、有马有人
  for (const s of world.stations) {
    assert.ok((world.adjacency.get(s.id)?.length ?? 0) >= 2, `${s.name} 度数不足`);
    assert.ok(s.horseIds.length >= 5, `${s.name} 马匹不足`);
    assert.ok(s.courierIds.length >= 3, `${s.name} 驿卒不足`);
  }
});

test('地图:同一种子生成完全一致的世界', () => {
  const a = generateWorld(42);
  const b = generateWorld(42);
  assert.deepEqual(
    a.stations.map((s) => [s.x, s.y, s.name]),
    b.stations.map((s) => [s.x, s.y, s.name]),
  );
  assert.deepEqual(
    a.roads.map((r) => [r.a, r.b, r.distance, r.terrain]),
    b.roads.map((r) => [r.a, r.b, r.distance, r.terrain]),
  );
});

test('地图:马与驿卒挂在正确的驿站资产清单上', () => {
  const world = generateWorld(7);
  for (const h of world.horses) {
    assert.ok(world.stations[h.stationId].horseIds.includes(h.id));
  }
  for (const c of world.couriers) {
    assert.ok(world.stations[c.stationId].courierIds.includes(c.id));
  }
  assert.ok(world.horses.length > 150);
  assert.ok(world.couriers.length > 90);
});

test('配置:默认规则覆盖全部地形与天气', () => {
  for (const terrain of ['plain', 'hills', 'mountain', 'desert', 'river_crossing'] as const) {
    assert.ok(DEFAULT_CONFIG.terrain[terrain]);
  }
  for (const weather of ['clear', 'cloudy', 'rain', 'storm', 'fog'] as const) {
    assert.ok(DEFAULT_CONFIG.weather[weather]);
  }
  assert.equal(DEFAULT_CONFIG.urgency[1].deadlineMinutes, 4320); // 3 个游戏日
});
