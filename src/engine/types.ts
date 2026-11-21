/**
 * 八百里加急 · 领域类型定义
 * 时间单位统一为「游戏分钟」,距离单位为「里」。
 */

/** 紧急等级:三等为常规,一等即八百里加急 */
export type UrgencyLevel = 1 | 2 | 3;

/** 公文状态 */
export type DocumentStatus =
  | 'queued' // 已派单,等待资源规划
  | 'in_transit' // 在途
  | 'arrived' // 已送达
  | 'overdue'; // 超时未达(继续跑,但计入超时)

/** 马匹状态 */
export type HorseStatus = 'available' | 'assigned' | 'riding' | 'sick';

/** 驿卒状态 */
export type CourierStatus = 'available' | 'assigned' | 'riding' | 'resting';

/** 地形 */
export type Terrain = 'plain' | 'hills' | 'mountain' | 'desert' | 'river_crossing';

/** 天气 */
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

/** 事件类型 */
export type IncidentType = 'rain_block' | 'horse_sick' | 'bandit' | 'reopen';

export interface Station {
  id: number;
  name: string;
  x: number; // 地图坐标 0..1000
  y: number; // 地图坐标 0..700
  isCapital: boolean;
  isFrontier: boolean;
  horseIds: number[];
  courierIds: number[];
}

export interface Road {
  id: number;
  a: number;
  b: number;
  distance: number; // 里
  terrain: Terrain;
  weather: Weather;
  /** 断路截止时间(游戏分钟),小于当前时间视为畅通 */
  blockedUntil: number;
}

export interface Horse {
  id: number;
  stationId: number;
  name: string;
  /** 0..100,当前体力 */
  stamina: number;
  /** 累病/休整恢复时间点,horse.sick 时有效 */
  recoverAt: number;
  status: HorseStatus;
  /** 当前承担的公文(一程锁定) */
  documentId: number | null;
}

export interface Courier {
  id: number;
  stationId: number;
  name: string;
  /** 0..100,疲劳度,越高速度越慢 */
  fatigue: number;
  /** 休整完成时间点(resting 时使用) */
  availableAt: number;
  status: CourierStatus;
  documentId: number | null;
}

/** 已规划/已执行的一程 */
export interface Leg {
  fromStation: number;
  toStation: number;
  horseId: number;
  courierId: number;
  roadId: number;
  /** 出发时间 */
  departTick: number;
  /** 预计到达时间(规划时刻的估计) */
  eta: number;
  /** 实际到达时间,执行完才有 */
  arrivedAt: number | null;
  /** 出发时扣减后的剩余体力(审计用) */
  staminaAfter: number;
}

/** 追加式事件日志条目,已发生的事不可修改 */
export interface Incident {
  id: number;
  tick: number;
  type: IncidentType;
  documentId: number | null;
  roadId: number | null;
  stationId: number | null;
  message: string;
}

export interface DocumentOrder {
  id: number;
  code: string; // 公文编号,如 急-0042
  urgency: UrgencyLevel;
  origin: number;
  destination: number;
  createdAt: number;
  deadline: number; // 截止游戏时间
  status: DocumentStatus;
  legs: Leg[];
  /** 当前所在驿站(途中为上一站) */
  currentStation: number;
  /** 途中行程进度 0..1 */
  progress: number;
  /** 当前程开始时间 / 计划时长,供地图插值 */
  legStartTick: number;
  legDuration: number;
  /** 累计重规划次数 */
  replanCount: number;
  /** 首次规划的预计送达时间,用于统计计划/实际偏差 */
  initialEta: number | null;
  /** 送达时间 */
  deliveredAt: number | null;
}

export interface SimStats {
  totalCreated: number;
  totalDelivered: number;
  totalOverdue: number;
  inTransit: number;
  queued: number;
  replans: number;
  incidents: number;
  /** 最近一次全量重规划耗时(毫秒) */
  lastReplanMs: number;
  /** 各紧急等级准时情况 */
  byUrgency: Record<UrgencyLevel, { created: number; delivered: number; onTime: number }>;
  /** 最近 N 单的实际/计划用时比,供统计页展示 */
  recentRatios: number[];
}

/** 策划可调规则,改完立即生效 */
export interface RuleConfig {
  tickMinutes: number;
  /** 一天的游戏分钟数 */
  minutesPerDay: number;
  /** 各紧急等级:限时(游戏分钟)、速度系数、体力消耗系数 */
  urgency: Record<UrgencyLevel, { deadlineMinutes: number; speedMul: number; staminaMul: number; label: string }>;
  /** 基准速度:里/游戏分钟(800 里场景下的基准节奏) */
  baseSpeedPerMin: number;
  terrain: Record<Terrain, { speedMul: number; staminaMul: number; label: string }>;
  weather: Record<Weather, { speedMul: number; label: string }>;
  stamina: {
    /** 每分钟自然恢复 */
    recoverPerMin: number;
    /** 每「里·等级系数」消耗的体力 */
    costPerLi: number;
    /** 低体力速度惩罚:每缺 1 点体力损失的速度比例 */
    lowStaminaSpeedPenalty: number;
    /** 生病恢复所需分钟 */
    sickRecoverMinutes: number;
    /** 体力低于该值才会考虑等待恢复 */
    minUsableStamina: number;
  };
  courier: {
    /** 每程增加的疲劳 */
    fatiguePerLeg: number;
    /** 每分钟自然恢复的疲劳 */
    restPerMin: number;
    /** 每点疲劳带来的速度折损比例 */
    fatigueSpeedPenalty: number;
  };
  incidents: {
    /** 每 tick 下雨断路概率 */
    rainProb: number;
    /** 每 tick 马匹病倒概率(对在骑马匹) */
    horseSickProb: number;
    /** 每 tick 劫道概率(对在途公文) */
    banditProb: number;
    /** 断路持续分钟范围 */
    blockDurationMin: number;
    blockDurationMax: number;
    /** 劫道滞留分钟范围 */
    banditDelayMin: number;
    banditDelayMax: number;
  };
  world: {
    stationCount: number;
    autoSpawnProb: number; // 每 tick 自动来新公文的概率
  };
}

/** 资源预约:某马/驿卒在 [start, end) 时间窗内被某份公文的某程占用 */
export interface Reservation {
  documentId: number;
  start: number;
  end: number;
}

export interface World {
  tick: number;
  stations: Station[];
  roads: Road[];
  horses: Horse[];
  couriers: Courier[];
  documents: DocumentOrder[];
  incidents: Incident[];
  config: RuleConfig;
  stats: SimStats;
  /** 邻接表缓存:stationId -> [{roadId, other}] */
  adjacency: Map<number, { roadId: number; other: number }[]>;
  /** 马匹时间窗预约:horseId -> 预约列表(按 start 排序) */
  horseReservations: Map<number, Reservation[]>;
  /** 驿卒时间窗预约 */
  courierReservations: Map<number, Reservation[]>;
  nextDocumentId: number;
  nextIncidentId: number;
}

/** 规划结果 */
export interface PlanResult {
  legs: Leg[];
  /** 预计送达时间 */
  eta: number | null;
  feasible: boolean;
  reason: string;
  /** 规划耗时毫秒 */
  elapsedMs: number;
}
