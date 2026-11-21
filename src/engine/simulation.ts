import type {
  DocumentOrder,
  Incident,
  IncidentType,
  SimStats,
  UrgencyLevel,
  World,
} from './types.ts';
import { Rng } from './rng.ts';
import { deadlineOf } from './config.ts';
import { staminaCost } from './travel.ts';
import { planDocument, releaseLegResources } from './planner.ts';
import { prunePastReservations } from './reservations.ts';

export function createStats(): SimStats {
  return {
    totalCreated: 0,
    totalDelivered: 0,
    totalOverdue: 0,
    inTransit: 0,
    queued: 0,
    replans: 0,
    incidents: 0,
    lastReplanMs: 0,
    byUrgency: {
      1: { created: 0, delivered: 0, onTime: 0 },
      2: { created: 0, delivered: 0, onTime: 0 },
      3: { created: 0, delivered: 0, onTime: 0 },
    },
    recentRatios: [],
  };
}

/** 构建邻接表(道路增删后需重建) */
export function buildAdjacency(world: World): void {
  world.adjacency.clear();
  for (const road of world.roads) {
    const push = (a: number, b: number) => {
      const list = world.adjacency.get(a);
      if (list) list.push({ roadId: road.id, other: b });
      else world.adjacency.set(a, [{ roadId: road.id, other: b }]);
    };
    push(road.a, road.b);
    push(road.b, road.a);
  }
}

function logIncident(world: World, type: IncidentType, message: string, extra?: Partial<Incident>): Incident {
  const incident: Incident = {
    id: world.nextIncidentId++,
    tick: world.tick,
    type,
    documentId: null,
    roadId: null,
    stationId: null,
    message,
    ...extra,
  };
  world.incidents.push(incident);
  world.stats.incidents++;
  if (world.incidents.length > 200) world.incidents.splice(0, world.incidents.length - 200);
  return incident;
}

/** 仿真引擎:推进时间、注入事故、(重)规划与履约 */
export class SimulationEngine {
  readonly world: World;
  private rng: Rng;
  /** 最近一个 tick 产生的事故,供 UI 弹提示 */
  lastTickIncidents: Incident[] = [];

  constructor(world: World, seed: number) {
    this.world = world;
    this.rng = new Rng(seed ^ 0x9e3779b9);
  }

  /** 派单(自动或手动) */
  spawn(origin: number, destination: number, urgency: UrgencyLevel): DocumentOrder {
    const w = this.world;
    const id = w.nextDocumentId++;
    const doc: DocumentOrder = {
      id,
      code: `急-${String(id).padStart(4, '0')}`,
      urgency,
      origin,
      destination,
      createdAt: w.tick,
      deadline: deadlineOf(w.config, urgency, w.tick),
      status: 'queued',
      legs: [],
      currentStation: origin,
      progress: 0,
      legStartTick: w.tick,
      legDuration: 0,
      replanCount: 0,
      initialEta: null,
      deliveredAt: null,
    };
    w.documents.push(doc);
    w.stats.totalCreated++;
    w.stats.byUrgency[urgency].created++;
    return doc;
  }

  /** 手动制造事故:断路 */
  blockRoad(roadId: number, durationMin?: number): void {
    const w = this.world;
    const road = w.roads[roadId];
    const dur =
      durationMin ?? this.rng.int(w.config.incidents.blockDurationMin, w.config.incidents.blockDurationMax);
    road.blockedUntil = w.tick + dur;
    logIncident(w, 'rain_block', `暴雨冲断「${w.stations[road.a].name}—${w.stations[road.b].name}」驿路,预计 ${dur} 分钟后恢复`, {
      roadId,
    });
    this.replanAll();
  }

  /** 手动制造事故:马病倒 */
  sickenHorse(horseId: number): void {
    const w = this.world;
    const horse = w.horses[horseId];
    horse.status = 'sick';
    horse.recoverAt = w.tick + w.config.stamina.sickRecoverMinutes;
    horse.stamina = Math.min(horse.stamina, 20);
    const doc = horse.documentId !== null ? w.documents.find((d) => d.id === horse.documentId) : undefined;
    logIncident(w, 'horse_sick', `马匹「${horse.name}」病倒于${w.stations[horse.stationId].name}`, {
      stationId: horse.stationId,
      documentId: doc?.id ?? null,
    });
    if (doc) this.replanDocument(doc);
  }

  /** 手动制造事故:劫道,在途公文当前程增加滞留(已出发的程不撤回) */
  banditAttack(documentId: number): void {
    const w = this.world;
    const doc = w.documents.find((d) => d.id === documentId);
    if (!doc || doc.status !== 'in_transit') return;
    const active = doc.legs.find((l) => l.arrivedAt === null);
    if (!active) return;
    const delay = this.rng.int(w.config.incidents.banditDelayMin, w.config.incidents.banditDelayMax);
    // 滞留只顺延时刻,人马与路线都不变;在骑的程等到站后按正常流程重排后续
    active.eta += delay;
    doc.legDuration += delay;
    logIncident(w, 'bandit', `${doc.code} 途中遭遇劫道,滞留 ${delay} 分钟`, { documentId: doc.id });
    // 未出发的预案才立即重规划;在骑则保留整程,不可撤回
    if (!this.isRiding(doc)) this.replanDocument(doc);
  }

  /**
   * 重新规划单份公文。已跑完的 Leg 原样保留,只重排未来各程。
   * 在骑中的程不可撤回;否则丢弃未执行预案(预约由规划器内部清理)后整段重算。
   */
  replanDocument(doc: DocumentOrder): boolean {
    const w = this.world;
    if (doc.status === 'arrived') return false;
    // 正在骑马赶路的一程不可撤回:整段保留,等到达后再规划后续
    if (this.isRiding(doc)) return false;

    // 释放旧预案对下一程的硬锁(若有),丢弃全部未执行预案
    const next = doc.legs.find((l) => l.arrivedAt === null);
    if (next) this.releaseLock(next);
    doc.legs = doc.legs.filter((l) => l.arrivedAt !== null);

    const result = planDocument(w, doc, w.tick);
    if (result.legs.length > 0) {
      doc.legs.push(...result.legs);
      doc.legStartTick = result.legs[0].departTick;
      doc.legDuration = Math.max(1, result.legs[0].eta - result.legs[0].departTick);
      doc.status = 'in_transit';
      if (doc.initialEta === null) doc.initialEta = result.eta;
      doc.replanCount++;
      w.stats.replans++;
      return true;
    }
    // 无路或无马:回到队列,后续 tick 自动重试
    doc.status = 'queued';
    doc.replanCount++;
    w.stats.replans++;
    return false;
  }

  /** 到站续程:把下一程已有预约转正为硬锁;预约失效则整单重规划 */
  private continueAfterArrival(doc: DocumentOrder): boolean {
    const next = doc.legs.find((l) => l.arrivedAt === null);
    if (!next) return this.replanDocument(doc);
    if (!this.legStillValid(next)) return this.replanDocument(doc);
    this.lockLeg(next, doc.id);
    doc.status = 'in_transit';
    doc.legStartTick = next.departTick;
    doc.legDuration = Math.max(1, next.eta - next.departTick);
    return true;
  }

  /** 预约腿是否仍可转正:人马在本站、当前无硬锁、道路未封、出发时刻未过 */
  private legStillValid(leg: DocumentOrder['legs'][number]): boolean {
    const w = this.world;
    const horse = w.horses[leg.horseId];
    const courier = w.couriers[leg.courierId];
    const road = w.roads[leg.roadId];
    if (horse.status === 'sick') return false;
    if (horse.documentId !== null) return false;
    if (courier.documentId !== null) return false;
    if (horse.stationId !== leg.fromStation || courier.stationId !== leg.fromStation) return false;
    if (road.blockedUntil > w.tick) return false;
    if (leg.departTick < w.tick) return false;
    return true;
  }

  private lockLeg(leg: DocumentOrder['legs'][number], documentId: number): void {
    const horse = this.world.horses[leg.horseId];
    const courier = this.world.couriers[leg.courierId];
    horse.status = 'assigned';
    horse.documentId = documentId;
    courier.status = 'assigned';
    courier.documentId = documentId;
  }

  /** 全量重规划:所有非在途公文重排,返回总耗时毫秒(性能基准用) */
  replanAll(): number {
    const start = performance.now();
    for (const doc of this.world.documents) {
      if (doc.status === 'arrived') continue;
      if (this.isRiding(doc)) continue;
      this.replanDocument(doc);
    }
    const elapsed = performance.now() - start;
    this.world.stats.lastReplanMs = elapsed;
    return elapsed;
  }

  /** 推进一个 tick */
  tick(): void {
    const w = this.world;
    w.tick += w.config.tickMinutes;
    this.lastTickIncidents = [];
    prunePastReservations(w);
    this.recoverResources();
    this.rollWeatherAndBlocks();
    this.randomIncidents();
    this.completeLegs();
    this.dispatchPending();
    this.markOverdue();
    this.maybeSpawn();
    this.refreshStats();
  }

  // ---- 内部 ----

  private isRiding(doc: DocumentOrder): boolean {
    const active = doc.legs.find((l) => l.arrivedAt === null);
    return !!active && active.departTick <= this.world.tick;
  }

  private releaseLock(leg: DocumentOrder['legs'][number]): void {
    const w = this.world;
    const horse = w.horses[leg.horseId];
    const courier = w.couriers[leg.courierId];
    if (horse.documentId !== null) {
      horse.status = 'available';
      horse.documentId = null;
    }
    if (courier.documentId !== null) {
      courier.status = courier.status === 'resting' ? 'resting' : 'available';
      courier.documentId = null;
    }
  }

  /** 马力恢复、驿卒休整、病马痊愈 */
  private recoverResources(): void {
    const w = this.world;
    const dt = w.config.tickMinutes;
    for (const horse of w.horses) {
      if (horse.status === 'riding' || horse.status === 'assigned') continue;
      if (horse.status === 'sick') {
        if (w.tick >= horse.recoverAt) {
          // 痊愈:病马在站养病期间其公文已改派,残留锁必须清掉
          horse.status = 'available';
          horse.documentId = null;
          horse.stamina = Math.max(horse.stamina, 45);
        }
        continue;
      }
      horse.stamina = Math.min(100, horse.stamina + w.config.stamina.recoverPerMin * dt);
    }
    for (const courier of w.couriers) {
      if (courier.status !== 'resting') continue;
      courier.fatigue = Math.max(0, courier.fatigue - w.config.courier.restPerMin * dt);
      if (w.tick >= courier.availableAt || courier.fatigue <= 5) {
        courier.status = 'available';
        courier.availableAt = -1;
      }
    }
  }

  /** 天气小幅漂移;断路到期自动恢复并触发一次重规划 */
  private rollWeatherAndBlocks(): void {
    const w = this.world;
    const weathers = ['clear', 'clear', 'cloudy', 'rain', 'fog', 'storm'] as const;
    let reopened = false;
    for (const road of w.roads) {
      if (this.rng.chance(0.08)) road.weather = this.rng.pick(weathers);
      if (road.blockedUntil > 0 && w.tick >= road.blockedUntil) {
        road.blockedUntil = -1;
        reopened = true;
        this.lastTickIncidents.push(
          logIncident(w, 'reopen', `「${w.stations[road.a].name}—${w.stations[road.b].name}」驿路恢复通行`, {
            roadId: road.id,
          }),
        );
      }
    }
    if (reopened) this.replanAll();
  }

  /** 随机事故:断路、马病倒、劫道 */
  private randomIncidents(): void {
    const w = this.world;
    const cfg = w.config.incidents;
    // 断路
    for (const road of w.roads) {
      if (road.blockedUntil > w.tick) continue;
      if (this.rng.chance(cfg.rainProb)) {
        const dur = this.rng.int(cfg.blockDurationMin, cfg.blockDurationMax);
        road.blockedUntil = w.tick + dur;
        road.weather = 'storm';
        this.lastTickIncidents.push(
          logIncident(w, 'rain_block', `暴雨冲断「${w.stations[road.a].name}—${w.stations[road.b].name}」驿路`, {
            roadId: road.id,
          }),
        );
      }
    }
    // 马病倒(只针对在骑马匹)
    for (const horse of w.horses) {
      if (horse.status === 'riding' && this.rng.chance(cfg.horseSickProb)) {
        this.sickenHorse(horse.id);
      }
    }
    // 劫道
    for (const doc of w.documents) {
      if (doc.status === 'in_transit' && this.isRiding(doc) && this.rng.chance(cfg.banditProb)) {
        this.banditAttack(doc.id);
      }
    }
    if (this.lastTickIncidents.some((i) => i.type === 'rain_block')) this.replanAll();
  }

  /** 到达处理:完成一程、结算资源、送达判定,否则接排下一程 */
  private completeLegs(): void {
    const w = this.world;
    for (const doc of w.documents) {
      if (doc.status !== 'in_transit') continue;
      const active = doc.legs.find((l) => l.arrivedAt === null);
      if (!active || active.departTick > w.tick || w.tick < active.eta) continue;

      active.arrivedAt = w.tick;
      // 结算马体力并归还资源(途中病倒的马到站后继续养病)
      const horse = w.horses[active.horseId];
      const wasSick = horse.status === 'sick';
      const cost = staminaCost(w.roads[active.roadId], doc.urgency, w.config);
      horse.stamina = Math.max(0, horse.stamina - cost);
      releaseLegResources(w, active);
      if (wasSick) {
        // 途中病倒的马到站后继续养病,绝不参与再分配
        horse.status = 'sick';
        horse.documentId = null;
        horse.recoverAt = w.tick + w.config.stamina.sickRecoverMinutes;
      }
      // 从旧站资产清单移到新站(stationId 已由 releaseLegResources 同步)
      this.moveAssetIds(w.stations[active.fromStation].horseIds, w.stations[active.toStation].horseIds, active.horseId);
      this.moveAssetIds(w.stations[active.fromStation].courierIds, w.stations[active.toStation].courierIds, active.courierId);
      doc.currentStation = active.toStation;
      doc.progress = doc.legs.filter((l) => l.arrivedAt !== null).length / doc.legs.length;

      if (active.toStation === doc.destination) {
        // 即使此前已被标记 overdue,送达即结案
        doc.status = 'arrived';
        doc.deliveredAt = w.tick;
        doc.progress = 1;
        w.stats.totalDelivered++;
        const bucket = w.stats.byUrgency[doc.urgency];
        bucket.delivered++;
        if (w.tick <= doc.deadline) bucket.onTime++;
        if (doc.initialEta !== null) {
          w.stats.recentRatios.push(w.tick / Math.max(1, doc.initialEta));
          if (w.stats.recentRatios.length > 50) w.stats.recentRatios.shift();
        }
        continue;
      }
      // 到站:优先把下一程的时间窗预约转正为硬锁,预约失效才整单重规划
      this.continueAfterArrival(doc);
    }
  }

  private moveAssetIds(from: number[], to: number[], id: number): void {
    const idx = from.indexOf(id);
    if (idx !== -1) from.splice(idx, 1);
    if (!to.includes(id)) to.push(id);
  }

  /** 为待派发/待续程的公文锁定下一程 */
  private dispatchPending(): void {
    const w = this.world;
    for (const doc of w.documents) {
      if (doc.status === 'arrived') continue;
      if (this.isRiding(doc)) continue;
      const hasFutureLeg = doc.legs.some((l) => l.arrivedAt === null);
      if (hasFutureLeg) {
        // 预案已在(等待出发时间),把状态维持在途
        doc.status = 'in_transit';
        continue;
      }
      const ok = this.replanDocument(doc);
      if (ok) {
        const first = doc.legs.find((l) => l.arrivedAt === null)!;
        doc.legStartTick = first.departTick;
        doc.legDuration = Math.max(1, first.eta - first.departTick);
      }
    }

    // 到点出发:assigned -> riding
    for (const doc of w.documents) {
      const active = doc.legs.find((l) => l.arrivedAt === null);
      if (!active || active.departTick > w.tick) continue;
      const horse = w.horses[active.horseId];
      const courier = w.couriers[active.courierId];
      if (horse.status === 'assigned') horse.status = 'riding';
      if (courier.status === 'assigned') courier.status = 'riding';
      doc.status = 'in_transit';
    }
  }

  private markOverdue(): void {
    const w = this.world;
    for (const doc of w.documents) {
      if (doc.status === 'arrived') continue;
      if (w.tick > doc.deadline && doc.status !== 'overdue') {
        doc.status = 'overdue';
        w.stats.totalOverdue++;
      }
    }
  }

  private maybeSpawn(): void {
    const w = this.world;
    if (!this.rng.chance(w.config.world.autoSpawnProb)) return;
    const n = w.stations.length;
    const capital = w.stations.find((s) => s.isCapital)!;
    const frontiers = w.stations.filter((s) => s.isFrontier);
    const frontier = this.rng.pick(frontiers);
    // 70% 京城→边关,30% 任意两站
    let origin = capital.id;
    let destination = frontier.id;
    if (this.rng.chance(0.3)) {
      origin = this.rng.int(0, n);
      do {
        destination = this.rng.int(0, n);
      } while (destination === origin);
    }
    const urgency = this.rng.pick<UrgencyLevel>([1, 1, 2, 2, 3]);
    this.spawn(origin, destination, urgency);
  }

  private refreshStats(): void {
    const w = this.world;
    w.stats.inTransit = w.documents.filter((d) => d.status === 'in_transit' || d.status === 'overdue').length;
    w.stats.queued = w.documents.filter((d) => d.status === 'queued').length;
  }

  /** 当前程插值进度,供地图平滑移动 */
  interpolateProgress(doc: DocumentOrder): number {
    const active = doc.legs.find((l) => l.arrivedAt === null);
    if (!active) return doc.progress;
    if (this.world.tick <= active.departTick) return doc.progress;
    const t = (this.world.tick - active.departTick) / Math.max(1, active.eta - active.departTick);
    return Math.min(1, Math.max(0, t));
  }
}
