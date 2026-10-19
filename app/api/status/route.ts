import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader, phoneFromCookieHeader } from '@/lib/auth';
import { accountStatus } from '@/lib/account';
import { getEnvSources } from '@/lib/env-sources';
import { getEnvLiveSources } from '@/lib/env-live-sources';
import { getEnvSubscriptions } from '@/lib/env-subscriptions';
import { getEnvRecommendSource } from '@/lib/env-recommend-source';
import { getEnvImageMode } from '@/lib/env-image-mode';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';

/** 站点状态：客户端据此决定是否弹出登录框 / 提示激活授权 / 提示续期，并获取预置采集站与预置直播源 */
export async function GET(req: Request) {
  const passwordRequired = isPasswordConfigured();
  const cookieHeader = req.headers.get('cookie');
  const phone = phoneFromCookieHeader(cookieHeader);
  const loggedIn = !!phone && sessionFromCookieHeader(cookieHeader);
  return NextResponse.json({
    passwordRequired,
    verified: loggedIn,
    // 三端互通账号：登录状态与授权剩余时间
    account: loggedIn && phone ? { loggedIn: true, phone, ...accountStatus(phone) } : { loggedIn: false },
    // 商业模式开关（默认关闭 = 前期永久免费，不校验剩余时间）
    commercialMode: getSettings().commercialMode,
    // 构建时由 next.config.ts 从 package.json 注入
    version: process.env.APP_VERSION || 'dev',
    // 部署者通过 DEFAULT_SOURCES 预置的采集站
    defaultSources: getEnvSources(),
    // 部署者通过 DEFAULT_LIVE_SOURCES 预置的直播源（M3U 订阅）
    defaultLiveSources: getEnvLiveSources(),
    // 部署者通过 DEFAULT_SUBSCRIPTIONS 预置的 SourceList 订阅链接
    defaultSubscriptions: getEnvSubscriptions(),
    // 部署者通过 DEFAULT_RECOMMEND_SOURCE 指定的首页推荐数据源默认值（未配置时为 null）
    defaultRecommendSource: getEnvRecommendSource() ?? null,
    // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时为 null）
    defaultImageMode: getEnvImageMode() ?? null,
  });
}
