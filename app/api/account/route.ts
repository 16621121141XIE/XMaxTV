import { NextResponse } from 'next/server';
import { registerAccount, loginAccount, accountStatus } from '@/lib/account';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

export const runtime = 'nodejs';

/** 注册 / 登录：手机号 + 密码，登录成功后写入会话 cookie（三端共享） */
export async function POST(req: Request) {
  let body: { action?: string; phone?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  const action = body.action;
  const phone = String(body.phone ?? '').trim();
  const password = String(body.password ?? '');

  if (action === 'register') {
    const r = registerAccount(phone, password);
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return loginAndSetCookie(req, phone, password);
  }

  if (action === 'login') {
    return loginAndSetCookie(req, phone, password);
  }

  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}

function loginAndSetCookie(req: Request, phone: string, password: string) {
  const r = loginAccount(phone, password);
  if (!r.success) return NextResponse.json(r, { status: 400 });

  const { token, expiresAt } = signSession(phone);
  const secure = process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http') === 'https';

  const res = NextResponse.json({ success: true, status: accountStatus(phone) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    path: '/',
  });
  return res;
}
