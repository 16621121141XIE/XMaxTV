import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from './auth';
import { getSettings } from './settings';

/**
 * API Route 共享守卫。
 * - 商业模式关闭（默认，前期永久免费）：游客直接放行，不校验 PASSWORD、不要求登录；
 * - 商业模式开启：未配置密码返回 503，未登录返回 401。
 */
export function guardRequest(req: Request): NextResponse | null {
  // 关闭商业模式：游客模式，公开内容（搜索/详情/榜单/直播等）一律放行
  if (!getSettings().commercialMode) {
    return null;
  }
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { error: '服务器未设置 PASSWORD 环境变量' },
      { status: 503 }
    );
  }
  if (!sessionFromCookieHeader(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
