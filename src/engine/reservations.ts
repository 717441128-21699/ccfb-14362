import type { Reservation, World } from './types.ts';

/**
 * 资源时间窗预约表。
 * 同一匹马/驿卒可被多份公文在互不重叠的时间窗预约,
 * 规划器据此为整条接力链路预约资源,而不是只锁当前程。
 */

function list(map: Map<number, Reservation[]>, id: number): Reservation[] {
  let arr = map.get(id);
  if (!arr) {
    arr = [];
    map.set(id, arr);
  }
  return arr;
}

/** 时间窗 [start, end) 是否与已有预约冲突 */
export function hasConflict(world: World, kind: 'horse' | 'courier', id: number, start: number, end: number): boolean {
  const map = kind === 'horse' ? world.horseReservations : world.courierReservations;
  const arr = map.get(id);
  if (!arr) return false;
  for (const r of arr) {
    if (r.start < end && start < r.end) return true;
  }
  return false;
}

/** 新增一条预约(保持按 start 排序) */
export function addReservation(world: World, kind: 'horse' | 'courier', id: number, r: Reservation): void {
  const map = kind === 'horse' ? world.horseReservations : world.courierReservations;
  const arr = list(map, id);
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].start < r.start) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, r);
}

/** 移除某份公文在指定资源上的全部预约(重规划时清理旧预案) */
export function removeDocumentReservations(world: World, documentId: number): void {
  const sweep = (map: Map<number, Reservation[]>) => {
    for (const [id, arr] of map) {
      const kept = arr.filter((r) => r.documentId !== documentId);
      if (kept.length !== arr.length) map.set(id, kept);
    }
  };
  sweep(world.horseReservations);
  sweep(world.courierReservations);
}

/** 清理已经完全处于当前 tick 之前的过期预约,控制表体积 */
export function prunePastReservations(world: World): void {
  const sweep = (map: Map<number, Reservation[]>) => {
    for (const [id, arr] of map) {
      const kept = arr.filter((r) => r.end > world.tick);
      if (kept.length !== arr.length) map.set(id, kept);
    }
  };
  sweep(world.horseReservations);
  sweep(world.courierReservations);
}
