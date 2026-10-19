import { NextResponse } from 'next/server';
import { phoneFromCookieHeader } from '@/lib/auth';
import { isAdmin } from '@/lib/keys';
import { loadWhitelist, addWhitelist, removeWhitelist } from '@/lib/whitelist';

export const runtime = 'nodejs';

function guard(req: Request): boolean {
  return isAdmin(phoneFromCookieHeader(req.headers.get('cookie')));
}

/** 管理员白名单管理：录入手机号后对应用户剩余时间变为 9999 天（永久免费） */
export async function GET(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  return NextResponse.json({ success: true, whitelist: loadWhitelist() });
}

export async function POST(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  let body: { action?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  const phone = String(body.phone ?? '').trim();
  if (body.action === 'add') {
    const r = addWhitelist(phone);
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, whitelist: loadWhitelist() });
  }
  if (body.action === 'remove') {
    const r = removeWhitelist(phone);
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, whitelist: loadWhitelist() });
  }
  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}
