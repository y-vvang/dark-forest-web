import { V24_CONFIG, type EnvConfig } from "@/lib/engine/config";

/**
 * 在线世界环境配置：v2.4 权威参数 + **slotReuse: true（对实验的明示偏离，用户
 * 2026-10-14"取消 36 上限"）**——多生命世界（玩家死亡→再排队）的出生供给保障；
 * env2_v24 硬上限单局 36 次出生，缺省世界（金标准/单机）不开启保持忠实。
 */
export const ONLINE_ENV_CONFIG: EnvConfig = { ...V24_CONFIG, slotReuse: true };

/**
 * 在线模式常量（计划定稿）。TICK_SECONDS 为 DESIGN §13 的"占位初值"——
 * 逐记录存档（WorldRecord.tickSeconds），改常量只影响新世界。
 */
export const TICK_SECONDS = 20;

/** 推进锁 TTL：远大于单次推进耗时（冷重演 ~0.5s）；中途过期由版本 CAS 兜底 */
export const LOCK_TTL_MS = 5000;

/** 变更类操作锁忙时的重试上限（提交须赶在刻截止前落地） */
export const LOCK_WAIT_MS = 2500;

/** 排队心跳剪除阈值：静默超过 FACTOR×tickSeconds 未轮询即剪（防 AFK 占位） */
export const HEARTBEAT_FACTOR = 2;

/** stage_b 评测口径 ε（与单人对手同源同流约定） */
export const EVAL_EPSILON = 0.05;

/** 四臂轮替序：初始 4 席 = 各一；此后非玩家出生按此循环（用户 2026-10-12 裁决） */
export const ARM_ROTATION = ["a_classic", "b_terminal", "c_res", "d_malintent"] as const;

/** 记录体积告警目标（Upstash 免费档月带宽 10GB 是真约束，计划架构节） */
export const RECORD_WARN_BYTES = 65_536;
