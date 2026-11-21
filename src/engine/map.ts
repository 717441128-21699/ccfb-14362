import type { Courier, Horse, Road, RuleConfig, Station, Terrain, Weather, World } from './types.ts';
import { DEFAULT_CONFIG, cloneConfig } from './config.ts';
import { Rng } from './rng.ts';
import { buildAdjacency, createStats } from './simulation.ts';

const STATION_SUFFIX = ['驿', '关', '堡', '津', '铺', '渡', '口'];
const NAME_A = ['青', '云', '雁', '龙', '虎', '铁', '玉', '金', '石', '风', '雪', '霜', '沙', '柳', '松', '潼', '萧', '凉', '甘', '肃'];
const NAME_B = ['崖', '门', '山', '水', '河', '岭', '原', '州', '桥', '谷', '泽', '坡', '塘', '亭', '台'];
const HORSE_NAMES = ['乌骓', '赤骥', '白义', '逾轮', '山子', '渠黄', '华骝', '绿耳', '燎原', '追电', '绝影', '的卢', '翻羽', '奔霄'];
const SURNAMES = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '陈', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '许', '何', '吕', '张'];
const GIVEN = ['守义', '承恩', '定远', '长风', '疾行', '千里', '怀安', '秉忠', '铁柱', '三郎', '老七', '有福', '知途', '不困', '连山'];

const WEATHERS: Weather[] = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'fog', 'storm'];

interface Point {
  x: number;
  y: number;
}

function dist2(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** MST(Prim)保证全图连通,所有 MST 边永不被裁剪 */
function minimumSpanningTree(points: Point[]): Array<[number, number]> {
  const n = points.length;
  const used = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  const edges: Array<[number, number]> = [];
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    let v = -1;
    for (let j = 0; j < n; j++) {
      if (!used[j] && (v === -1 || best[j] < best[v])) v = j;
    }
    used[v] = true;
    if (parent[v] !== -1) edges.push([parent[v], v]);
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = dist2(points[v], points[j]);
      if (d < best[j]) {
        best[j] = d;
        parent[j] = v;
      }
    }
  }
  return edges;
}

/**
 * 按种子随机生成一张驿路图:30 个驿站、保证连通的无向道路网。
 * 京城在东,边关在西,西段多山地荒漠,东段多平原渡津。
 */
export function generateWorld(seed: number, config: RuleConfig = DEFAULT_CONFIG): World {
  const rng = new Rng(seed);
  // 持有独立副本,运行时改规则不污染默认配置,也不影响其它世界
  const ownConfig = config === DEFAULT_CONFIG ? cloneConfig(DEFAULT_CONFIG) : config;
  const n = ownConfig.world.stationCount;
  const cols = 6; // 6×5 = 30

  const stations: Station[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 70 + col * 172 + rng.float(-28, 28);
    const y = 60 + row * 145 + rng.float(-24, 24);
    let name = `${rng.pick(NAME_A)}${rng.pick(NAME_B)}${rng.pick(STATION_SUFFIX)}`;
    while (usedNames.has(name)) name = `${rng.pick(NAME_A)}${rng.pick(NAME_B)}${rng.pick(STATION_SUFFIX)}`;
    usedNames.add(name);
    stations.push({
      id: i,
      name,
      x: Math.round(x),
      y: Math.round(y),
      isCapital: false,
      isFrontier: false,
      horseIds: [],
      courierIds: [],
    });
  }

  // 京城:最东列中段;边关:最西列中段
  const capitalId = stations.filter((s) => s.x > 700).sort((a, b) => a.y - b.y)[Math.floor(2 / 1)].id;
  const frontierCandidates = stations.filter((s) => s.x < 200);
  const frontierId = frontierCandidates.reduce((best, s) =>
    Math.abs(s.y - stations[capitalId].y) < Math.abs(best.y - stations[capitalId].y) ? s : best,
  ).id;
  stations[capitalId].isCapital = true;
  stations[capitalId].name = '京城驿';
  stations[frontierId].isFrontier = true;
  stations[frontierId].name = '定远关';

  // 道路:MST 打底 + 网格邻接概率连线 + 少量驰道直连
  const edgeSet = new Set<string>();
  const roads: Road[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const addRoad = (a: number, b: number): boolean => {
    if (a === b || edgeSet.has(key(a, b))) return false;
    edgeSet.add(key(a, b));
    const pa = stations[a];
    const pb = stations[b];
    const coord = Math.sqrt(dist2(pa, pb));
    const distance = Math.max(60, Math.min(260, Math.round(coord * 1.15)));
    // 西段偏山地荒漠,中段丘陵,东段平原;长路更可能是渡津
    let terrain: Terrain;
    const midX = (pa.x + pb.x) / 2;
    if (coord > 240 && rng.chance(0.55)) terrain = 'river_crossing';
    else if (midX < 300) terrain = rng.pick<Terrain>(['mountain', 'mountain', 'desert', 'hills']);
    else if (midX < 620) terrain = rng.pick<Terrain>(['hills', 'hills', 'plain', 'mountain']);
    else terrain = rng.pick<Terrain>(['plain', 'plain', 'hills', 'river_crossing']);
    roads.push({
      id: roads.length,
      a,
      b,
      distance,
      terrain,
      weather: rng.pick(WEATHERS),
      blockedUntil: -1,
    });
    return true;
  };

  for (const [a, b] of minimumSpanningTree(stations)) addRoad(a, b);

  // 同网格行/列相邻站大概率有路
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ci = i % cols;
      const ri = Math.floor(i / cols);
      const cj = j % cols;
      const rj = Math.floor(j / cols);
      const adjacent = (ri === rj && Math.abs(ci - cj) === 1) || (ci === cj && Math.abs(ri - rj) === 1);
      if (adjacent && rng.chance(0.72)) addRoad(i, j);
    }
  }
  // 斜向近邻 + 少量长距驰道,补足路网密度
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(dist2(stations[i], stations[j]));
      if (d < 210 && rng.chance(0.3)) addRoad(i, j);
    }
  }
  for (let k = 0; k < 8; k++) {
    addRoad(rng.int(0, n), rng.int(0, n));
  }
  // 兜底:任何站度数不得小于 2
  const degree = new Array<number>(n).fill(0);
  for (const r of roads) {
    degree[r.a]++;
    degree[r.b]++;
  }
  for (let i = 0; i < n; i++) {
    if (degree[i] >= 2) continue;
    const nearest = stations
      .map((s, j) => ({ j, d: j === i ? Infinity : dist2(s, stations[i]) }))
      .sort((p, q) => p.d - q.d);
    for (const { j } of nearest) {
      if (addRoad(i, j)) {
        degree[i]++;
        degree[j]++;
        if (degree[i] >= 2) break;
      }
    }
  }

  // 马匹与驿卒
  const horses: Horse[] = [];
  const couriers: Courier[] = [];
  for (const s of stations) {
    const horseCount = rng.int(5, 9) + (s.isCapital || s.isFrontier ? 3 : 0);
    for (let k = 0; k < horseCount; k++) {
      const id = horses.length;
      horses.push({
        id,
        stationId: s.id,
        name: `${rng.pick(HORSE_NAMES)}-${String(id).padStart(3, '0')}`,
        stamina: rng.intIncl(55, 100),
        recoverAt: -1,
        status: 'available',
        documentId: null,
      });
      s.horseIds.push(id);
    }
    const courierCount = rng.int(3, 6) + (s.isCapital || s.isFrontier ? 2 : 0);
    for (let k = 0; k < courierCount; k++) {
      const id = couriers.length;
      couriers.push({
        id,
        stationId: s.id,
        name: `${rng.pick(SURNAMES)}${rng.pick(GIVEN)}`,
        fatigue: rng.intIncl(0, 30),
        availableAt: -1,
        status: 'available',
        documentId: null,
      });
      s.courierIds.push(id);
    }
  }

  const world: World = {
    tick: 0,
    stations,
    roads,
    horses,
    couriers,
    documents: [],
    incidents: [],
    config: ownConfig,
    stats: createStats(),
    adjacency: new Map(),
    horseReservations: new Map(),
    courierReservations: new Map(),
    nextDocumentId: 1,
    nextIncidentId: 1,
  };
  buildAdjacency(world);
  return world;
}
