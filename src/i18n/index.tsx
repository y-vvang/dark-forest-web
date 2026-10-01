"use client";

/**
 * Zero-dependency i18n (DESIGN.md §12, user-confirmed 2026-09-30).
 *
 * - Locales: zh / en, default en. No manual switch anywhere in the app.
 * - Resolution on load: ?lang=zh|en (writes localStorage "lang")
 *   > localStorage > navigator.language (zh* → zh, else en).
 * - en is the type source (src/i18n/en.ts); zh is compile-checked against it;
 *   the runtime resolver falls back zh → en → raw key.
 * - The locale is client-only state that never changes during a session, so
 *   it is read through useSyncExternalStore: the server snapshot is "en"
 *   (hydration-safe), the client resolves after hydration — no effects,
 *   no setState-on-mount, all animation remains CSS-only.
 */
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useSyncExternalStore,
} from "react";

import { en, type MessageKey, type TParams } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";
export type { MessageKey, TParams };

const STORAGE_KEY = "lang";

function isLocale(value: string | null): value is Locale {
    return value === "en" || value === "zh";
}

function detectLocale(): Locale {
    if (typeof window === "undefined") return "en";

    const query = new URLSearchParams(window.location.search).get("lang");
    if (isLocale(query)) {
        window.localStorage.setItem(STORAGE_KEY, query);
        return query;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;

    return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** the locale never changes within a session — resolve once, then it is stable */
let resolvedLocale: Locale | null = null;

function getLocaleSnapshot(): Locale {
    if (resolvedLocale === null) resolvedLocale = detectLocale();
    return resolvedLocale;
}

const subscribeToNothing = () => () => {};

const getServerLocale = (): Locale => "en";

interface I18nContextValue {
    locale: Locale;
    t: (key: MessageKey, params?: TParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const locale = useSyncExternalStore(
        subscribeToNothing,
        getLocaleSnapshot,
        getServerLocale,
    );

    const t = useCallback(
        (key: MessageKey, params?: TParams): string => {
            const raw =
                (locale === "zh" ? zh[key] : en[key]) ?? en[key] ?? (key as string);
            if (params === undefined) return raw;
            return raw.replace(/\{(\w+)\}/g, (_match, name: string) =>
                String(params[name] ?? ""),
            );
        },
        [locale],
    );

    const value = useMemo(() => ({ locale, t }), [locale, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (ctx === null) throw new Error("useI18n must be used within I18nProvider");
    return ctx;
}
