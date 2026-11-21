import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../src/engine/map.ts';
import { SimulationEngine } from '../src/engine/simulation.ts';

/** 综合冒烟:模拟 UI 全部操作路径长时间运行,校验全局不变量 */
test('冒烟:500 tick 混合操作后全局资源与公文不变量成立', () => {
  const world = generateWorld(31337);
  const engine = new SimulationEngine(world, 31337);
  const capital = world.stations.find((s) => s.isCapital)!;
  const frontier = world.stations.find((s) => s.isFrontier)!;

  for (let i = 0; i < 500; i++) {
    engine.tick();
    // 每 25 tick 手动制造一次各类事故
    if (i % 25 === 0) {
      const road = world.roads[i % world.roads.length];
      engine.blockRoad(road.id);
      const freeHorse = world.horses.find((h) => h.status === 'riding');
      if (freeHorse) engine.sickenHorse(freeHorse.id);
      const moving = world.documents.find((d) => engine['isRiding'](d));
      if (moving) engine.banditAttack(moving.id);
    }
    // 每 40 tick 热更新一次规则
    if (i % 40 === 0) {
      world.config.stamina.costPerLi = 0.1 + (i % 5) * 0.03;
      world.config.baseSpeedPerMin = 0.45 + (i % 4) * 0.05;
      engine.replanAll();
    }
    // 每 10 tick 手动派一单
    if (i % 10 === 0) {
      const doc = engine.spawn(capital.id, frontier.id, ((i % 3) + 1) as 1 | 2 | 3);
      engine.replanDocument(doc);
    }
  }

  // 不变量 1:同一匹马/驿卒最多被一份未完成公文锁定
  const horseLocks = new Map<number, number>();
  const courierLocks = new Map<number, number>();
  for (const doc of world.documents) {
    if (doc.status === 'arrived') continue;
    const future = doc.legs.filter((l) => l.arrivedAt === null);
    // 在骑或已派的只有「下一条未出发/在骑程」持有锁
    const lockable = future.slice(0, 1);
    for (const leg of lockable) {
      const h = horseLocks.get(leg.horseId);
      assert.ok(h === undefined || h === doc.id, `马 ${leg.horseId} 被多单同时锁定`);
      horseLocks.set(leg.horseId, doc.id);
      const c = courierLocks.get(leg.courierId);
      assert.ok(c === undefined || c === doc.id, `驿卒 ${leg.courierId} 被多单同时锁定`);
      courierLocks.set(leg.courierId, doc.id);
    }
  }

  // 不变量 2:马/驿卒的 documentId 与锁表一致(病马在站养病期间可能残留历史锁,单独豁免)
  for (const horse of world.horses) {
    if (horse.status === 'assigned' || horse.status === 'riding') {
      assert.ok(horse.documentId !== null);
      assert.equal(horseLocks.get(horse.id), horse.documentId);
    } else if (horse.status !== 'sick') {
      assert.equal(horse.documentId, null);
    }
  }
  for (const courier of world.couriers) {
    if (courier.status === 'assigned' || courier.status === 'riding') {
      assert.ok(courier.documentId !== null);
      assert.equal(courierLocks.get(courier.id), courier.documentId);
    } else {
      assert.equal(courier.documentId, null);
    }
  }

  // 不变量 3:已送达公文腿链完整、终点正确、资源已归还
  for (const doc of world.documents.filter((d) => d.status === 'arrived')) {
    assert.equal(doc.currentStation, doc.destination);
    assert.ok(doc.deliveredAt !== null);
    for (const leg of doc.legs) assert.ok(leg.arrivedAt !== null);
    for (let k = 1; k < doc.legs.length; k++) {
      assert.equal(doc.legs[k].fromStation, doc.legs[k - 1].toStation);
    }
  }

  // 不变量 4:未在骑公文的未来预案不得使用当前断路
  for (const doc of world.documents) {
    if (doc.status === 'arrived' || engine['isRiding'](doc)) continue;
    for (const leg of doc.legs.filter((l) => l.arrivedAt === null)) {
      assert.equal(world.roads[leg.roadId].blockedUntil > world.tick, false, '预案走了断路');
    }
  }

  // 不变量 5:资产清单与实体所属驿站一致
  for (const horse of world.horses) {
    assert.ok(world.stations[horse.stationId].horseIds.includes(horse.id));
  }
  for (const courier of world.couriers) {
    assert.ok(world.stations[courier.stationId].courierIds.includes(courier.id));
  }

  assert.ok(world.stats.totalDelivered > 0, '长时运行应有公文送达');
  assert.ok(world.stats.replans > 0);
  assert.ok(world.stats.incidents > 0);
});
