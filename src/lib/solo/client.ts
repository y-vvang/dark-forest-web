"use client";

/**
 * /match 装配层：op 参数解析 → 配置读取（sessionStorage）→ 模型按需加载 →
 * SoloMatch + ViewTracker 构造。页面组件保持瘦；此模块是唯一接触 SoloMatch
 * 构造细节的客户端代码。
 *
 * v2.4 新增：
 * - **模型参谋**（用户 2026-10-10）：advise() 对玩家当前 obs/valid 行跑四臂
 *   greedy（dqn.act，ε=0 零 RNG——不触碰会话随机流）；一旦用过，advised=true
 *   供结束弹窗标记（诚实披露：使用过 AI 参谋）。
 * - **环境配置**：readEnvConfig()（cfg-io，缺省/损坏 = v2.4 权威默认）。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { isOpponentId } from "@/lib/opponents/catalog";
import { act, loadModel, type ModelWeights } from "@/lib/opponents/dqn";
import { ARM_IDS } from "@/lib/solo/rewards";
import { readEnvConfig } from "@/lib/solo/cfg-io";
import { N_ACTIONS, OBS_DIM } from "@/lib/engine/types";
import { SoloMatch } from "@/lib/solo/match";
import { ViewTracker, type MatchView } from "@/lib/solo/view";

export type LoadState =
    | { status: "redirect" } // 非法 op / 模型加载失败 → 页面层 replace /solo
    | { status: "loading" }
    | { status: "ready"; view: MatchView };

/** 参谋单条：臂 id + 该模型的 greedy 选择（UI 翻译动作名） */
export interface Advice {
    arm: string;
    action: number;
}

export interface MatchSession {
    state: LoadState;
    /** READY 后：提交玩家一选（ViewTracker 契约——每次提交后恰一次 update） */
    submitAction: (action: number, target: number) => void;
    /** READY 后：受入侵重选 */
    submitRechoice: (action: number) => void;
    /** READY 后：取消入侵重选（保持本刻原动作） */
    cancelRechoice: () => void;
    /** READY 后：四臂模型参谋（本刻 greedy 选择）；用过即置 advised（结束弹窗标记） */
    advise: () => Promise<Advice[]>;
    /** 本局是否用过参谋（诚实披露——终局弹窗标记） */
    advised: boolean;
}

export function useSoloMatch(opParam: string | null): MatchSession {
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const [advised, setAdvised] = useState(false);
    const matchRef = useRef<SoloMatch | null>(null);
    const trackerRef = useRef<ViewTracker | null>(null);
    /** 参谋权重缓存（臂 id → 权重；懒加载） */
    const advisorWeights = useRef<Map<string, ModelWeights>>(new Map());

    // 种子：会话内一次（crypto 随机；console.info 便于排障复现）
    const seed = useMemo(() => {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        const s = buf[0] >>> 1;
        console.info("[darkforest] match seed", s);
        return s;
    }, []);

    const ids = useMemo(
        () => (opParam ?? "").split(",").map((x) => x.trim()).filter((x) => x !== ""),
        [opParam],
    );

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (ids.length === 0 || ids.some((id) => !isOpponentId(id))) {
                setState({ status: "redirect" });
                return;
            }
            const modelIds = ids.filter(
                (id) => id !== "random" && id !== "df" && id !== "pacifist",
            );
            const uniqueModels = [...new Set(modelIds)];
            try {
                const list: ModelWeights[] = await Promise.all(
                    uniqueModels.map((id) => loadModel(id)),
                );
                if (cancelled) return;
                const weights = new Map(uniqueModels.map((_, i) => [list[i].arm, list[i]]));
                const match = new SoloMatch(seed, ids, weights, readEnvConfig());
                const tracker = new ViewTracker(match);
                tracker.update(); // 排队态先更新一次 → 发出 waitBirth（默认配置下排队恒为 1 刻：
                // 初始池均值 ≥ 150−80 = 70 > 预滚上限 20，玩家必在第 1 刻出生，无中间出生可漏）
                match.start();
                matchRef.current = match;
                trackerRef.current = tracker;
                setState({ status: "ready", view: tracker.update() }); // t0 结算 → birthSelf
            } catch (err) {
                // 模型 404 等 → 回 /solo（与非法参数同路）
                console.error("[darkforest] match setup failed", err);
                if (!cancelled) setState({ status: "redirect" });
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [ids, seed]);

    /** 提交后恰一次 update（ViewTracker 消费契约） */
    const push = () => {
        const tr = trackerRef.current;
        if (tr !== null) setState({ status: "ready", view: tr.update() });
    };

    const advise = async (): Promise<Advice[]> => {
        const m = matchRef.current;
        if (m === null || m.playerSlot === null) return [];
        for (const arm of ARM_IDS) {
            if (!advisorWeights.current.has(arm)) {
                try {
                    advisorWeights.current.set(arm, await loadModel(arm));
                } catch (err) {
                    // 参谋为辅助功能：单臂加载失败不毁对局，跳过该臂
                    console.error("[darkforest] advisor weights failed", err);
                }
            }
        }
        const p = m.playerSlot;
        const obs = m.env.obs().subarray(p * OBS_DIM, (p + 1) * OBS_DIM);
        const valid = m.env.valid().subarray(p * N_ACTIONS, (p + 1) * N_ACTIONS);
        const out: Advice[] = [];
        for (const arm of ARM_IDS) {
            const w = advisorWeights.current.get(arm);
            if (w !== undefined) out.push({ arm, action: act(w, obs, valid) });
        }
        if (out.length > 0) setAdvised(true); // 用过即标（终局弹窗披露）
        return out;
    };

    return {
        state,
        submitAction: (action, target) => {
            const m = matchRef.current;
            if (m === null) return;
            m.submitAction(action, target);
            push();
        },
        submitRechoice: (action) => {
            const m = matchRef.current;
            if (m === null) return;
            m.submitRechoice(action);
            push();
        },
        cancelRechoice: () => {
            const m = matchRef.current;
            if (m === null) return;
            m.cancelRechoice();
            push();
        },
        advise,
        advised,
    };
}
