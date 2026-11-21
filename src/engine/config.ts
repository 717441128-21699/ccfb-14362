import type { RuleConfig, UrgencyLevel } from './types.ts';

/** 默认规则 —— 策划在规则面板上的修改直接改这张表的运行时副本,下一单立即生效 */
export const DEFAULT_CONFIG: RuleConfig = {
  tickMinutes: 10,
  minutesPerDay: 1440,
  urgency: {
    1: { deadlineMinutes: 4320, speedMul: 1.35, staminaMul: 1.3, label: '八百里加急(一等)' },
    2: { deadlineMinutes: 7200, speedMul: 1.15, staminaMul: 1.1, label: '紧急(二等)' },
    3: { deadlineMinutes: 11520, speedMul: 1.0, staminaMul: 1.0, label: '常规(三等)' },
  },
  // 基准 0.55 里/分钟 ≈ 平原一天 ~790 里,一等加急靠换马与系数压进 3 日
  baseSpeedPerMin: 0.55,
  terrain: {
    plain: { speedMul: 1.0, staminaMul: 1.0, label: '平原' },
    hills: { speedMul: 0.85, staminaMul: 1.15, label: '丘陵' },
    mountain: { speedMul: 0.6, staminaMul: 1.4, label: '山地' },
    desert: { speedMul: 0.75, staminaMul: 1.3, label: '荒漠' },
    river_crossing: { speedMul: 0.7, staminaMul: 1.2, label: '渡津' },
  },
  weather: {
    clear: { speedMul: 1.0, label: '晴' },
    cloudy: { speedMul: 0.95, label: '阴' },
    rain: { speedMul: 0.8, label: '雨' },
    storm: { speedMul: 0.55, label: '暴雨' },
    fog: { speedMul: 0.75, label: '大雾' },
  },
  stamina: {
    recoverPerMin: 0.035,
    costPerLi: 0.16,
    lowStaminaSpeedPenalty: 0.004,
    sickRecoverMinutes: 2400,
    minUsableStamina: 12,
  },
  courier: {
    fatiguePerLeg: 14,
    restPerMin: 0.03,
    fatigueSpeedPenalty: 0.0025,
  },
  incidents: {
    rainProb: 0.012,
    horseSickProb: 0.004,
    banditProb: 0.0025,
    blockDurationMin: 600,
    blockDurationMax: 3000,
    banditDelayMin: 120,
    banditDelayMax: 480,
  },
  world: {
    stationCount: 30,
    autoSpawnProb: 0.35,
  },
};

/** 深拷贝规则,用于「恢复默认」与初始基线保存 */
export function cloneConfig(config: RuleConfig): RuleConfig {
  return structuredClone(config);
}

export function deadlineOf(config: RuleConfig, urgency: UrgencyLevel, createdAt: number): number {
  return createdAt + config.urgency[urgency].deadlineMinutes;
}
