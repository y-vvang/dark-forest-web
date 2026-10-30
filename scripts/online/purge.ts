/**
 * 手动清空在线模式 Upstash 命名空间（dev 卫生；用户 2026-10-28 裁定：
 * 生产 Vercel 对残留键已正确处理——世界跨部署持久是设计，不做运行时清理）。
 *
 * 用法：bun run purge:online
 * 需 .env.local 提供 UPSTASH_REDIS_REST_URL/TOKEN（bun 原生自动加载）。
 * 清除 df:online:*（idx/记录/锁/心跳）并打印条目数。
 */
import { getStore } from "@/lib/online/store";

const n = await getStore().purgeAll();
console.log(`[purge:online] cleared ${n} key(s) under df:online:*`);
