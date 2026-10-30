/**
 * 线协议 + 世界记录类型（计划"线协议"节）。
 *
 * 记录只存人类输入：AI 动作/引擎态/视图/日志永不落盘——重演时按种子化流
 * 确定性推导（seedOf 约定同单机）。日志增量用条数游标（since）：log.invaded
 * 与同刻结算事件共享同一刻号，按刻切片会丢事件（计划级裁定）。
 */
import type { LogEntryView, MatchView } from "@/lib/solo/view";

/** 窗口条目：ticks[i] 覆盖窗口 i+1（刻 i+1 飞行中）；最后一条可能开窗 */
export interface TickEntry {
    beganAtMs: number;
    /** null = 开窗中（本刻未结算） */
    endedAtMs: number | null;
    /** 本窗口收集的下一刻人类提交：slot → [action, target]；缺 = SILENT */
    nextActions: Record<string, [number, number]>;
    /** 本刻受害者的人类重选：slot → action（5|6）；-1 = 明确保持原动作 */
    rechoices: Record<string, number>;
}

export interface WorldRecord {
    /** 乐观锁版本：写入方置 expectedVersion+1，store 校验库内值 */
    v: number;
    worldId: string;
    seed: number;
    status: "running" | "ended";
    tickSeconds: number;
    createdAtMs: number;
    endedAtMs: number | null;
    ticks: TickEntry[];
    /** FIFO token（顺序即等待序；活性在独立心跳键，不入记录） */
    queue: string[];
    /** token → 加入时刻（当时已发生的出生数 = 已关窗条目数）。出生序 n 只配
     *  joinedAt < n 的队首——加入时刻入档使全量重演与活期 FIFO 弹出同构，否则
     *  中途加入者被幻影配对到更早的历史出生席（确定论缺陷，评审轮 2026-10-14）。
     *  缺省 0 = 世界起点（legacy 记录与测试构造）。 */
    joinedAt: Record<string, number>;
    /** token → 出生槽位（append-only 配对档案；advance 把已出生者移出 queue 后写入）。
     *  活性/死活不存——重演从 env.alive 推导（冗余态有漂移风险，2026-10-12 裁定删）。 */
    seats: Record<string, number>;
}

/** 世界指针 + 版本：轮询仅读此微型键（带宽预算核心） */
export interface WorldIndex {
    worldId: string;
    v: number;
}

// ---------------------------------------------------------------- 线协议

export interface Timing {
    serverNowMs: number;
    tickEndsAtMs: number;
    remainingSeconds: number;
    /** 飞行中刻号 = 已结算刻数 + 1；提交携带它做防陈旧校验 */
    tick: number;
    worldVersion: number;
}

/** 世界读数（刻/存活/池）——排队者唯一可见情报（game-mechanics §6.1） */
export interface WorldReadout {
    tick: number;
    tMax: number;
    nAlive: number;
    freePool: number;
}

/** 未带 token 的首访：只给世界读数 */
export interface LobbyPublicView {
    kind: "lobby-public";
    world: WorldReadout | null;
}

/** 排队中（未出生） */
export interface LobbyView {
    kind: "lobby";
    token: string;
    timing: Timing;
    world: WorldReadout;
    /** 1-based */
    queuePosition: number;
    /** 你是从一个已终局的世界滚动过来的（本视图本身是新世界）→ 客户端显示
     *  rollover 提示。评审 Important #5 改名自 worldEnded（名实相反）。 */
    rolledOver: boolean;
}

/** 在线控制台视图 = MatchView 去 reward/log + 日志增量（reward 恒 null，用户裁决③） */
export interface OnlineView extends Omit<MatchView, "reward" | "log"> {
    reward: null;
    log: LogEntryView[];
}

export interface ConsoleView {
    kind: "console";
    token: string;
    timing: Timing;
    view: OnlineView;
    /** 本窗口已提交的下一刻动作（null = 未提交 → 到点 SILENT） */
    submission: { action: number; target: number } | null;
}

export type StateResponse = LobbyPublicView | LobbyView | ConsoleView;

export interface QueueResponse {
    token: string;
    state: StateResponse;
}

export interface ActionRequest {
    token: string;
    /** 提交时所见的飞行中刻号 */
    tick: number;
    action: number;
    target: number;
}

export interface RechoiceRequest {
    token: string;
    tick: number;
    /** 5 = 声明黑域 | 6 = 反咬 | -1 = 明确保持原动作（协议兼容保留；与缺席等价） */
    action: number;
}

export type ErrorCode =
    | "invalid-request"
    | "invalid-action"
    | "unknown-token"
    | "stale-tick"
    | "not-born"
    | "not-invaded"
    /** 推进锁竞争超限（LOCK_WAIT_MS 内未取得）——可重试的过载，非客户端错误 */
    | "server-busy";

export interface ErrorResponse {
    error: ErrorCode;
}
