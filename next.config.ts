import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    // 模型权重 = 不可变静态资产（内容按 arm 名固定）——长缓存（部署约束：checkpoint 可长缓存）
    async headers() {
        return [
            {
                source: "/models/:path*",
                headers: [
                    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
                ],
            },
        ];
    },
};

export default nextConfig;
