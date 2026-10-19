import { NextResponse } from 'next/server';
import { phoneFromCookieHeader } from '@/lib/auth';
import { isAdmin, issueKey, listKeys } from '@/lib/keys';

export const runtime = 'nodejs';

function guard(req: Request): boolean {
  return isAdmin(phoneFromCookieHeader(req.headers.get('cookie')));
}

/** 管理员密钥管理：仅管理员手机号（16621121141）可见可用 */
export async function GET(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  return NextResponse.json({ success: true, keys: listKeys() });
}

export async function POST(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  let body: { action?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  if (body.action === 'issue') {
    const phone = String(body.phone ?? '').trim();
    const r = issueKey(phone);
    if (!r.success) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ success: true, code: r.code, phone });
  }
  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}
