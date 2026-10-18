// next.config.js — 由 next.config.ts 改写（纯 JS，运行时无需 TypeScript）
// 版本号以 package.json 为单一来源，构建时注入 process.env.APP_VERSION（/api/status 使用）
function readAppVersion() {
  try {
    const pkg = JSON.parse(
      require('node:fs').readFileSync(
        require('node:path').join(process.cwd(), 'package.json'),
        'utf8'
      )
    );
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 输出仅供 Docker 镜像构建使用（DOCKER_BUILD=1）；
  // 本地 next start 在 standalone 模式下不受支持，故按环境切换
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  reactStrictMode: true,
  env: { APP_VERSION: readAppVersion() },
  // 采集站/豆瓣等上游地址在运行时由用户配置，构建期无法枚举，关闭图片优化改用 <img>
  images: { unoptimized: true },
};

module.exports = nextConfig;
