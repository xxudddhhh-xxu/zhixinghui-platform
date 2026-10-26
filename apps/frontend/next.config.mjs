/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // 静态导出模式(pnpm run build:static):产物为纯静态文件,托管在 Cloudflare Pages,
  // 公开文档页由 /docs/view 客户端渲染承担(见 scripts/static-export.mjs)
  ...(process.env.STATIC_EXPORT
    ? { output: 'export', images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
