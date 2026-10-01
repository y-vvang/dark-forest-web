import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";

/**
 * Top bar (DESIGN.md §10.1): 40px chrome strip; left and right slots only —
 * no language control exists anywhere in the app (DESIGN.md §12).
 */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
    return (
        <header className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-subtle bg-panel px-4">
            <div className="flex min-w-0 items-center gap-4">{left}</div>
            {right !== undefined && (
                <div className="tnum flex flex-wrap items-center justify-end gap-x-4 text-base text-dim">
                    {right}
                </div>
            )}
        </header>
    );
}

export function BrandLink() {
    return (
        <Link href="/" className="text-sm font-bold text-ink">
            DARK FOREST
        </Link>
    );
}

export function BackLink({ href }: { href: string }) {
    const { t } = useI18n();
    return (
        <Link href={href} className="text-sm text-dim hover:text-ink">
            {"← "}
            {t("nav.back")}
        </Link>
    );
}
