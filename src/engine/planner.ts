import type { DocumentOrder, Leg, PlanResult, Road, World } from './types.ts';
import {
  courierReadyAt,
  isRoadBlocked,
  projectCourierFatigue,
  projectHorseStamina,
  roadBaseMinutes,
  staminaCost,
  travelMinutes,
} from './travel.ts';
import { addReservation, hasConflict, removeDocumentReservations } from './reservations.ts';

/** 资源等待上限:超过半日仍凑不齐一程,视为本站暂时无资源 */
const MAX_WAIT_MIN = 720;

/**
 * Dijkstra 最省时路径。
 * 边权 = 当前天气/地形/紧急等级下的基础通行分钟数;断路直接不参与图。
 * 返回驿站 id 序列,无路可走返回 null。
 */
export function findRoute(
  world: World,
  origin: number,
  destination: number,
  now: number,
  urgency: DocumentOrder['urgency'],
): number[] | null {
  const { stations, roads, adjacency, config } = world;
  const n = stations.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);
  dist[origin] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && (u === -1 || dist[i] < dist[u])) u = i;
    }
    if (u === -1 || dist[u] === Infinity) break;
    if (u === destination) break;
    visited[u] = true;
    const neighbors = adjacency.get(u) ?? [];
    for (const { roadId, other } of neighbors) {
      const road = roads[roadId];
      if (isRoadBlocked(road, now)) continue;
      const w = roadBaseMinutes(road, urgency, config);
      const nd = dist[u] + w;
      if (nd < dist[other] - 1e-9) {
        dist[other] = nd;
        prev[other] = u;
      }
    }
  }
  if (!Number.isFinite(dist[destination])) return null;
  const path: number[] = [];
  let cur = destination;
  while (cur !== -1) {
    path.push(cur);
    if (cur === origin) break;
    cur = prev[cur];
  }
  path.reverse();
  return path[0] === origin ? path : null;
}

interface ResourceChoice {
  horseId: number;
  courierId: number;
  departTick: number;
  eta: number;
  staminaAfter: number;
}

/**
 * 在 stationId 挑出最早能把公文送过 road 的马+驿卒组合。
 * 资源候选必须:当前可用/可恢复,且在占用时间窗内无其它预约。
 */
function chooseResources(
  world: World,
  stationId: number,
  road: Road,
  now: number,
  urgency: DocumentOrder['urgency'],
  documentId: number,
): ResourceChoice | null {
  const { horses, couriers, config } = world;
  const station = world.stations[stationId];
  const cost = staminaCost(road, urgency, config);
  let best: ResourceChoice | null = null;

  for (const hid of station.horseIds) {
    const horse = horses[hid];
    if (horse.status === 'sick') continue;
    for (const cid of station.courierIds) {
      const courier = couriers[cid];
      if (courier.status !== 'available' && courier.status !== 'resting') continue;

      let readyTick = Math.max(now, courierReadyAt(courier));
      // 等马恢复到既过最低可用线、又够付本程体力
      const staminaNow = projectHorseStamina(horse, world.tick, readyTick, config);
      const needStamina = Math.max(config.stamina.minUsableStamina, cost);
      let wait = 0;
      if (staminaNow < needStamina) {
        wait = (needStamina - staminaNow) / config.stamina.recoverPerMin;
        if (wait > MAX_WAIT_MIN) continue;
      }
      readyTick += wait;
      const stamina = Math.min(100, staminaNow + config.stamina.recoverPerMin * wait);
      const fatigue = projectCourierFatigue(courier, world.tick, readyTick, config);
      const duration = travelMinutes(road, urgency, stamina, fatigue, config);
      const eta = readyTick + duration;

      // 时间窗预约冲突检测(自身旧预约在调用前已清,不会自冲突)
      if (hasConflict(world, 'horse', horse.id, readyTick, eta)) continue;
      if (hasConflict(world, 'courier', courier.id, readyTick, eta)) continue;
      // 已被其它公文硬锁定的资源不可再预约
      if (horse.documentId !== null && horse.documentId !== documentId) continue;
      if (courier.documentId !== null && courier.documentId !== documentId) continue;

      if (!best || eta < best.eta) {
        best = { horseId: horse.id, courierId: courier.id, departTick: readyTick, eta, staminaAfter: Math.max(0, stamina - cost) };
      }
    }
  }
  return best;
}

/**
 * 为单份公文规划接力路线并预约全程资源。
 * - 路径由 Dijkstra 按当前路况算出,绝不写死;
 * - 每一程的马与驿卒都写入时间窗预约,多单可在不同时间安全复用同一资源;
 * - 只对「当前站→下一站」首程做硬锁定(documentId),后续各程靠预约表占位,到站后转正。
 * 调用前会先清除该公文的全部旧预约,保证重规划幂等。
 */
export function planDocument(world: World, doc: DocumentOrder, now: number): PlanResult {
  const start = performance.now();
  const fail = (reason: string): PlanResult => ({
    legs: [],
    eta: null,
    feasible: false,
    reason,
    elapsedMs: performance.now() - start,
  });

  removeDocumentReservations(world, doc.id);

  const path = findRoute(world, doc.currentStation, doc.destination, now, doc.urgency);
  if (!path || path.length < 2) return fail('no_route');

  const planned: Leg[] = [];
  let cursor = now;
  let blockedStation = -1;

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const adj = world.adjacency.get(from)!.find((e) => e.other === to)!;
    const road = world.roads[adj.roadId];
    const choice = chooseResources(world, from, road, cursor, doc.urgency, doc.id);
    if (!choice) {
      blockedStation = from;
      break;
    }
    const leg: Leg = {
      fromStation: from,
      toStation: to,
      horseId: choice.horseId,
      courierId: choice.courierId,
      roadId: road.id,
      departTick: choice.departTick,
      eta: choice.eta,
      arrivedAt: null,
      staminaAfter: choice.staminaAfter,
    };
    planned.push(leg);
    // 写入时间窗预约
    addReservation(world, 'horse', choice.horseId, { documentId: doc.id, start: choice.departTick, end: choice.eta });
    addReservation(world, 'courier', choice.courierId, { documentId: doc.id, start: choice.departTick, end: choice.eta });
    cursor = choice.eta;
  }

  if (blockedStation !== -1) {
    // 失败也要回滚本次已写入的预约,避免占着资源不放
    removeDocumentReservations(world, doc.id);
    return fail(`no_resource@${world.stations[blockedStation].name}`);
  }

  // 只硬锁首程
  const first = planned[0];
  const horse = world.horses[first.horseId];
  const courier = world.couriers[first.courierId];
  horse.status = 'assigned';
  horse.documentId = doc.id;
  courier.status = 'assigned';
  courier.documentId = doc.id;

  const eta = planned[planned.length - 1].eta;
  const meetsDeadline = eta <= doc.deadline;
  return {
    legs: planned,
    eta,
    feasible: meetsDeadline,
    reason: meetsDeadline ? 'ok' : 'deadline_risk',
    elapsedMs: performance.now() - start,
  };
}

/** 释放一程结束后的马与驿卒(人马都留在本程终点站,体力/疲劳已在到达时结算) */
export function releaseLegResources(world: World, leg: Leg): void {
  const horse = world.horses[leg.horseId];
  const courier = world.couriers[leg.courierId];
  horse.status = 'available';
  horse.documentId = null;
  horse.stationId = leg.toStation;
  courier.status = 'available';
  courier.documentId = null;
  courier.stationId = leg.toStation;
  courier.fatigue = Math.min(100, courier.fatigue + world.config.courier.fatiguePerLeg);
  // 疲劳过重进入休整
  if (courier.fatigue >= 80) {
    courier.status = 'resting';
    const restMin = (courier.fatigue - 40) / world.config.courier.restPerMin;
    courier.availableAt = world.tick + restMin;
  }
}
