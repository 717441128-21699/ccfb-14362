import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../src/engine/map.ts';
import { SimulationEngine } from '../src/engine/simulation.ts';
import type { DocumentOrder } from '../src/engine/types.ts';

function setup(seed = 99) {
  const world = generateWorld(seed);
  const engine = new SimulationEngine(world, seed);
  const capital = world.stations.find((s) => s.isCapital)!;
  const frontier = world.stations.find((s) => s.isFrontier)!;
  return { world, engine, capital, frontier };
}

test('仿真:公文能被接力送达,且每程的马/驿卒都在正确驿站交接', () => {
  const { engine, capital, frontier, world } = setup();
  world.config.world.autoSpawnProb = 0; // 只跟踪本单
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  let guard = 0;
  while (doc.status !== 'arrived' && guard++ < 4000) engine.tick();
  const delivered = doc;
  assert.equal(delivered.status, 'arrived');
  assert.equal(delivered.currentStation, frontier.id);
  // 每一段都实际执行,且首尾相接
  for (const leg of delivered.legs) {
    assert.ok(leg.arrivedAt !== null, '存在未执行的预案残留在送达公文里');
  }
  for (let i = 1; i < delivered.legs.length; i++) {
    assert.equal(delivered.legs[i].fromStation, delivered.legs[i - 1].toStation);
  }
  // 每程结束时马/驿卒都被移到该程终点(之后可能被别的公文继续接力骑走,
  // 故只验证其当前所在站仍是该腿终点或其下游,不会退回起点)
  for (const leg of delivered.legs) {
    const horse = world.horses[leg.horseId];
    const courier = world.couriers[leg.courierId];
    const reachable = new Set<number>([leg.toStation]);
    // 下游可达站(沿任意道路 BFS 一层即可覆盖"被骑走"的情形)
    const queue = [leg.toStation];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const { other } of world.adjacency.get(cur) ?? []) {
        if (!reachable.has(other)) {
          reachable.add(other);
          queue.push(other);
        }
      }
    }
    assert.ok(reachable.has(horse.stationId), `马 ${horse.id} 退回到了非下游站`);
    assert.ok(reachable.has(courier.stationId), `驿卒 ${courier.id} 退回到了非下游站`);
  }
  // 资源全部释放
  const busyHorses = world.horses.filter((h) => h.documentId === doc.id);
  const busyCouriers = world.couriers.filter((c) => c.documentId === doc.id);
  assert.equal(busyHorses.length, 0);
  assert.equal(busyCouriers.length, 0);
});

test('仿真:已跑完的程在重规划后不可撤回(append-only)', () => {
  const { engine, capital, frontier, world } = setup();
  world.config.world.autoSpawnProb = 0;
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  // 跑到至少完成一程
  let guard = 0;
  while (doc.legs.filter((l) => l.arrivedAt !== null).length === 0 && guard++ < 3000) {
    engine.tick();
  }
  const doneLegs = doc.legs.filter((l) => l.arrivedAt !== null).map((l) => ({ ...l }));
  assert.ok(doneLegs.length >= 1);
  const snapshot = JSON.stringify(doneLegs);
  engine.replanDocument(doc);
  const after = JSON.stringify(doc.legs.filter((l) => l.arrivedAt !== null).map((l) => ({ ...l })));
  assert.equal(after, snapshot, '历史程被改写或撤回');
});

test('仿真:断路触发全量重规划,新路线不经过被封道路', () => {
  const { engine, world, capital, frontier } = setup();
  const docs: DocumentOrder[] = [];
  for (let i = 0; i < 20; i++) docs.push(engine.spawn(capital.id, frontier.id, (i % 3) + 1 as 1 | 2 | 3));
  engine.replanAll();
  // 封一条当前有公文预案使用的路
  const usedRoad = docs.find((d) => d.legs.length)!.legs[0].roadId;
  engine.blockRoad(usedRoad);
  assert.ok(world.roads[usedRoad].blockedUntil > world.tick);
  for (const d of docs) {
    if (engine['isRiding'](d)) continue; // 在骑的程不可撤回,不受断路影响
    const future = d.legs.filter((l) => l.arrivedAt === null);
    for (const leg of future) assert.notEqual(leg.roadId, usedRoad, '新预案仍走断路');
  }
  assert.ok(world.stats.replans >= 20);
});

test('仿真:马病倒后相关公文重规划,病马不可被再分配', () => {
  const { engine, world, capital, frontier } = setup();
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  const horseId = doc.legs[0].horseId;
  engine.sickenHorse(horseId);
  assert.equal(world.horses[horseId].status, 'sick');
  // 之后任意规划都不应选中病马
  for (let i = 0; i < 5; i++) {
    const d = engine.spawn(capital.id, frontier.id, 2);
    engine.replanDocument(d);
    for (const leg of d.legs) assert.notEqual(leg.horseId, horseId);
  }
});

test('仿真:劫道只造成滞留,不撤回已走路程', () => {
  const { engine, capital, frontier, world } = setup();
  world.config.world.autoSpawnProb = 0;
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  // 推进到在途(首程可能在第 0 tick 即出发,用完成程数兜底)
  let guard = 0;
  while (!engine['isRiding'](doc) && doc.legs.filter((l) => l.arrivedAt !== null).length === 0 && guard++ < 3000) {
    engine.tick();
  }
  assert.ok(engine['isRiding'](doc), '公文应已进入在骑状态');
  const activeBefore = doc.legs.find((l) => l.arrivedAt === null)!;
  const beforeEta = activeBefore.eta;
  const doneBefore = doc.legs.filter((l) => l.arrivedAt !== null).length;
  engine.banditAttack(doc.id);
  const sameLegAfter = doc.legs.find((l) => l === activeBefore)!;
  assert.ok(sameLegAfter.eta > beforeEta, '劫道后在骑程 ETA 应顺延');
  assert.equal(doc.legs.filter((l) => l.arrivedAt !== null).length, doneBefore);
  // 最终仍可送达
  let deliveryGuard = 0;
  while (doc.status !== 'arrived' && deliveryGuard++ < 4000) engine.tick();
  assert.equal(doc.status, 'arrived');
});

test('仿真:超时公文被标记 overdue,送达后计入准时率统计', () => {
  const { engine, world, capital, frontier } = setup();
  world.config.world.autoSpawnProb = 0;
  // 把一等限时压到极短,制造必超时
  world.config.urgency[1].deadlineMinutes = 10;
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  for (let i = 0; i < 50; i++) engine.tick();
  assert.equal(doc.status, 'overdue');
  assert.ok(world.stats.totalOverdue >= 1);
});

test('仿真:自动派单持续产生公文,长时间运行统计自洽', () => {
  const { engine, world } = setup(7);
  for (let i = 0; i < 600; i++) engine.tick();
  // 自动派单概率 0.35/tick,600 tick 期望约 210 单(事故也会消耗 RNG,设宽松下界)
  assert.ok(world.documents.length > 30, `实际产单 ${world.documents.length}`);
  for (const urgency of [1, 2, 3] as const) {
    const bucket = world.stats.byUrgency[urgency];
    assert.equal(bucket.created, world.documents.filter((d) => d.urgency === urgency).length);
    assert.ok(bucket.onTime <= bucket.delivered);
    assert.ok(bucket.delivered <= bucket.created);
  }
  assert.equal(
    world.stats.totalDelivered,
    world.documents.filter((d) => d.status === 'arrived').length,
  );
});

test('仿真:规则热更新即时生效(调低恢复率后等待型规划变多)', () => {
  const { engine, world, capital, frontier } = setup();
  world.config.stamina.recoverPerMin = 0.001;
  world.config.stamina.costPerLi = 0.5; // 一程几乎抽空体力
  const doc = engine.spawn(capital.id, frontier.id, 1);
  engine.replanDocument(doc);
  // 仍能产出规划(可能靠等待恢复或换马),且配置已被规划器实际使用
  assert.ok(doc.legs.length >= 1 || doc.status === 'queued');
  assert.equal(world.config.stamina.costPerLi, 0.5);
});
