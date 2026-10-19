import { NextResponse } from 'next/server';
import { accountStatus, activateAccount, activateByCode, renewAccount, LICENSE_DAYS, PAY_AMOUNT } from '@/lib/account';
import { phoneFromCookieHeader } from '@/lib/auth';

export const runtime = 'nodejs';

/** GET：当前账号授权状态（剩余天数 / 是否过期） */
export async function GET(req: Request) {
  const phone = phoneFromCookieHeader(req.headers.get('cookie'));
  if (!phone) return NextResponse.json({ success: false, loggedIn: false });
  return NextResponse.json({
    success: true,
    loggedIn: true,
    phone,
    status: accountStatus(phone),
    licenseDays: LICENSE_DAYS,
    payAmount: PAY_AMOUNT,
  });
}

/**
 * POST：
 * - activate = 固定推广授权码首次激活 30 天（仅一次）
 * - code     = 动态激活码续期 30 天（密钥生成器验证，等同一次付款成功）
 * - renew    = 付款确认续期 30 天
 */
export async function POST(req: Request) {
  const phone = phoneFromCookieHeader(req.headers.get('cookie'));
  if (!phone) return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });

  let body: { action?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  if (body.action === 'activate') {
    const r = activateAccount(phone, String(body.code ?? ''));
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, status: accountStatus(phone) });
  }

  if (body.action === 'code') {
    const r = activateByCode(phone, String(body.code ?? ''));
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, status: accountStatus(phone) });
  }

  if (body.action === 'renew') {
    const r = renewAccount(phone);
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, status: accountStatus(phone) });
  }

  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}
