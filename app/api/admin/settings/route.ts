import { NextResponse } from 'next/server';
import { phoneFromCookieHeader } from '@/lib/auth';
import { isAdmin } from '@/lib/keys';
import { getSettings, setCommercialMode } from '@/lib/settings';

export const runtime = 'nodejs';

function guard(req: Request): boolean {
  return isAdmin(phoneFromCookieHeader(req.headers.get('cookie')));
}

/** 管理员全局设置（仅 16621121141） */
export async function GET(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  return NextResponse.json({ success: true, settings: getSettings() });
}

export async function POST(req: Request) {
  if (!guard(req)) return NextResponse.json({ success: false, error: '无管理员权限' }, { status: 403 });
  let body: { action?: string; commercialMode?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  if (body.action === 'set-commercial') {
    const settings = setCommercialMode(body.commercialMode === true);
    return NextResponse.json({ success: true, settings });
  }
  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
}
