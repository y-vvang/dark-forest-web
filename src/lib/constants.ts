import path from "node:path";
import { config } from "dotenv";

export const DEV_ENV_FILE = ".env.local";

if (!process.env.NODE_ENV) config({ path: path.resolve(process.cwd(), DEV_ENV_FILE) });

/**
 * Loads a server-side environment variable for use in the Next.js
 * project's `constants` object.
 *
 * Must be called lazily from a property getter so the variable is only
 * resolved (and validated) at access time, and always on the server.
 *
 * Resolution order:
 * - In production (`NODE_ENV === "production"`), reads `mainKey`.
 * - Otherwise, reads `devKey` if provided, falling back to `mainKey`.
 * - If the resolved key is unset, uses `fallbackValue`.
 *
 * Safety behavior:
 * - Throws immediately when invoked on the client, since server-side env
 *   vars are not available in the browser bundle.
 * - If no value can be resolved, sets `process.exitCode = 1` and throws,
 *   so missing configuration fails loudly at runtime.
 *
 * Do NOT use this for `NEXT_PUBLIC_*` variables — those are inlined into
 * the client bundle at build time and should be read directly.
 *
 * @param mainKey - The environment variable name to read in production.
 * @param devKey - Optional alternative variable name to read outside of
 *   production (e.g. a local development override). Defaults to `mainKey`.
 * @param fallbackValue - Optional value used when the resolved variable
 *   is not set.
 * @returns The resolved environment variable value.
 * @throws {Error} `ERR_ENV_VAR_USED_IN_CLIENT` if called on the client.
 * @throws {Error} `ERR_ENV_VAR_MISSING: ${key}` if the variable is unset
 *   and no fallback value was provided.
 *
 * @example
 * export const constants = {
 *   get databaseUrl() {
 *     return requireEnv("DATABASE_URL", "LOCAL_DATABASE_URL");
 *   },
 *   get stripeKey() {
 *     return requireEnv("STRIPE_SECRET_KEY", undefined, "sk_test_local");
 *   },
 * };
 */
export function requireEnv(mainKey: string, devKey?: string, fallbackValue?: string) {
    const key = process.env.NODE_ENV === "production" ? mainKey : (devKey ?? mainKey);
    if (typeof window !== "undefined") throw new Error(`ERR_ENV_VAR_USED_IN_CLIENT: ${key}`);
    const value = process.env[key] ?? fallbackValue;
    if (value === undefined) {
        process.exitCode = 1;
        throw new Error(`ERR_ENV_VAR_MISSING: ${key}`);
    };
    return value;
}

export const constants = {
    /**
     * Upstash Redis REST（在线模式共享世界存储）。缺席回退 ""：getStore 据此分流
     * （dev 无 env → 内存预览；产线缺 env → 显式抛错——两层都不静默）。
     */
    get upstashRedisRestUrl() {
        return requireEnv("UPSTASH_REDIS_REST_URL", undefined, "");
    },
    get upstashRedisRestToken() {
        return requireEnv("UPSTASH_REDIS_REST_TOKEN", undefined, "");
    },
} as const;