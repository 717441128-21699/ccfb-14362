/**
 * 可复现随机数(mulberry32)。
 * 同一种子生成的地图、事故序列完全一致,方便策划复盘与测试断言。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  /** [min, max] 闭区间整数 */
  intIncl(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** 以概率 p 命中 */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
