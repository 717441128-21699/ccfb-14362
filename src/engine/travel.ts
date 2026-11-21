import type { Courier, Horse, Road, RuleConfig, UrgencyLevel } from './types.ts';

/**
 * 行程计算原语 —— 全部为纯函数,策划改规则后这些公式自动吃新配置。
 * 时间:游戏分钟;距离:里;速度:里/分钟。
 */

/** 道路当前是否断路(已在途的驿卒不受影响,只拦截新进入的规划) */
export function isRoadBlocked(road: Road, now: number): boolean {
  return road.blockedUntil > now;
}

/** 道路基础通行时间(不含具体马匹/驿卒差异),Dijkstra 权重用它 */
export function roadBaseMinutes(road: Road, urgency: UrgencyLevel, config: RuleConfig): number {
  const speed =
    config.baseSpeedPerMin *
    config.urgency[urgency].speedMul *
    config.terrain[road.terrain].speedMul *
    config.weather[road.weather].speedMul;
  return road.distance / speed;
}

/** 一程体力消耗 */
export function staminaCost(road: Road, urgency: UrgencyLevel, config: RuleConfig): number {
  return (
    road.distance *
    config.stamina.costPerLi *
    config.terrain[road.terrain].staminaMul *
    config.urgency[urgency].staminaMul
  );
}

/** 给定马匹体力与驿卒疲劳下的实际速度 */
export function effectiveSpeed(
  road: Road,
  urgency: UrgencyLevel,
  horseStamina: number,
  courierFatigue: number,
  config: RuleConfig,
): number {
  const staminaFactor = Math.max(0.45, 1 - config.stamina.lowStaminaSpeedPenalty * (100 - horseStamina));
  const fatigueFactor = Math.max(0.6, 1 - config.courier.fatigueSpeedPenalty * courierFatigue);
  return (
    config.baseSpeedPerMin *
    config.urgency[urgency].speedMul *
    config.terrain[road.terrain].speedMul *
    config.weather[road.weather].speedMul *
    staminaFactor *
    fatigueFactor
  );
}

export function travelMinutes(
  road: Road,
  urgency: UrgencyLevel,
  horseStamina: number,
  courierFatigue: number,
  config: RuleConfig,
): number {
  return road.distance / effectiveSpeed(road, urgency, horseStamina, courierFatigue, config);
}

/** 可用马匹在未来 atTick 的投影体力(按恢复率线性恢复,上限 100) */
export function projectHorseStamina(horse: Horse, now: number, atTick: number, config: RuleConfig): number {
  if (horse.status === 'riding' || horse.status === 'assigned') return horse.stamina;
  return Math.min(100, horse.stamina + config.stamina.recoverPerMin * Math.max(0, atTick - now));
}

/** 休息中的驿卒在 atTick 的投影疲劳 */
export function projectCourierFatigue(courier: Courier, now: number, atTick: number, config: RuleConfig): number {
  if (courier.status !== 'resting') return courier.fatigue;
  return Math.max(0, courier.fatigue - config.courier.restPerMin * Math.max(0, atTick - now));
}

/** 驿卒最早可接活的时间点 */
export function courierReadyAt(courier: Courier): number {
  return courier.status === 'resting' ? courier.availableAt : 0;
}
