import { NextResponse } from 'next/server';
import { phoneFromCookieHeader } from '@/lib/auth';
import { isAdmin } from '@/lib/keys';
import { listTopups, confirmTopup, rejectTopup } from '@/lib/topup';

export const runtime = 'nodejs';

function guard(req: Request): boolean {
  return isAdmin(phoneFromCookieHeader(req.headers.get('cookie')));
}

/** 管理员：充值确认列表 */
export async function GET(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  return NextResponse.json({ success: true, topups: listTopups() });
}

/** 管理员：confirm 确认 +30 天；reject 拒绝 */
export async function POST(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  let body: { action?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  if (body.action === 'confirm') {
    const r = confirmTopup(String(body.id ?? ''));
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, topups: listTopups() });
  }
  if (body.action === 'reject') {
    const r = rejectTopup(String(body.id ?? ''));
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, topups: listTopups() });
  }
  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}
