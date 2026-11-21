/**
 * 性能基准:30 驿站、500 份在途公文时,一次全量重规划必须 < 100ms。
 * 运行:npm run bench
 */
import { generateWorld } from '../src/engine/map.ts';
import { SimulationEngine } from '../src/engine/simulation.ts';

const SEED = 20261122;
const DOC_COUNT = 500;
const WARMUP = 3;
const RUNS = 10;

const world = generateWorld(SEED);
const engine = new SimulationEngine(world, SEED);
const n = world.stations.length;

// 铺 500 单:随机起讫、随机紧急等级,先跑若干 tick 让部分公文进入在途/部分到站
let placed = 0;
while (placed < DOC_COUNT) {
  const origin = placed % n;
  let destination = (origin * 7 + 13) % n;
  if (destination === origin) destination = (destination + 1) % n;
  const urgency = ([1, 2, 3] as const)[placed % 3];
  engine.spawn(origin, destination, urgency);
  placed++;
}

for (let i = 0; i < 6; i++) engine.tick();

const activeBefore = world.documents.filter((d) => d.status !== 'arrived').length;
console.log(`世界:${world.stations.length} 站 / ${world.roads.length} 路 / ${world.horses.length} 马 / ${world.couriers.length} 驿卒`);
console.log(`公文:${world.documents.length} 单,其中待规划/在途 ${activeBefore} 单\n`);

for (let i = 0; i < WARMUP; i++) engine.replanAll();

const samples: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const ms = engine.replanAll();
  samples.push(ms);
}
const sorted = [...samples].sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const p95 = sorted[Math.floor(sorted.length * 0.95) - 1] ?? sorted.at(-1)!;

console.log(`全量重规划 ${RUNS} 次(每次覆盖 ${activeBefore} 单):`);
console.log(`  平均 ${avg.toFixed(2)} ms / 中位 ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} ms / P95 ${p95.toFixed(2)} ms / 最差 ${sorted.at(-1)!.toFixed(2)} ms`);
console.log(`  折合每单 ${(avg / activeBefore).toFixed(4)} ms`);

const target = 100;
if (p95 >= target) {
  console.error(`\n[FAIL] P95 ${p95.toFixed(2)}ms 超过 ${target}ms 红线`);
  process.exitCode = 1;
} else {
  console.log(`\n[PASS] P95 ${p95.toFixed(2)}ms < ${target}ms,满足主策划性能要求`);
}
