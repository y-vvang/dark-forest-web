/**
 * Selectable opponent card（DESIGN.md §10.10；2026-10-10 用户修订）——**内联详情，无浮层**。
 *
 * 原 popover 与点击选择存在交互冲突（点击既选中又钉浮层），用户裁定弃用：
 * 详情四件套全部内联进卡片——标题（预制 = i18n 风格名 / 模型 = 臂 id mono 技术记号）、
 * meta 行（600ep · seed 42）、奖励参数行（mono，自 V24_ARMS 推导）、动作画像一句
 * （i18n prose——替代原胜率罗列：数字为相对口径，具误导性）。
 * hover 仅升边；点击 = 选中/取消选择，`aria-pressed` 表达状态。
 */
import type { ReactNode } from "react";

export function OpponentCard({
    value,
    selected,
    onSelect,
    title,
    meta,
    override,
    desc,
}: {
    /** selection payload (preset kind or model id) */
    value: string;
    selected: boolean;
    onSelect: (value: string) => void;
    title: ReactNode;
    /** mono 读数行（600ep · seed 42） */
    meta?: ReactNode;
    /** mono 奖励参数行（soft 0.01 · bd 0.5 · +attack 0.5；预制无此行） */
    override?: ReactNode;
    /** 动作画像 prose（i18n） */
    desc?: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(value)}
            className={`flex min-h-20 w-full flex-col items-start justify-center gap-1 rounded-panel border p-3 text-left ${
                selected
                    ? "border-strong bg-raised"
                    : "border-subtle bg-panel hover:border-strong hover:bg-raised"
            }`}
        >
            <span className="flex w-full items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-ink">{title}</span>
                {meta !== undefined && <span className="tnum text-xs text-dim">{meta}</span>}
            </span>
            {override !== undefined && (
                <span className="tnum text-xs text-dim">{override}</span>
            )}
            {desc !== undefined && (
                <p className="font-sans text-xs leading-5 text-dim">{desc}</p>
            )}
        </button>
    );
}
