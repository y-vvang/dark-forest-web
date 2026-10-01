"use client";

/**
 * The app-level client entry (user request 2026-10-01): the one sanctioned
 * place for "use client" concerns that must run on every route — the I18n
 * provider and global side-effect polyfill imports. Keep layout.tsx itself
 * a server component (it owns the English-only metadata, DESIGN.md §12).
 *
 * Global side effects live here so every route loads them exactly once:
 * - @oddbird/popover-polyfill 0.7.2 backfills the native Popover API,
 *   including the auto-state rule that only ONE popover may be open
 *   document-wide, plus Escape and light-dismiss.
 */
import "@oddbird/popover-polyfill";

import { I18nProvider } from "@/i18n";

export function ClientLayout({ children }: { children: React.ReactNode }) {
    return <I18nProvider>{children}</I18nProvider>;
}
