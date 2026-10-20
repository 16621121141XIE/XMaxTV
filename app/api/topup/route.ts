import { NextResponse } from 'next/server';
import { phoneFromCookieHeader } from '@/lib/auth';
import { requestTopup } from '@/lib/topup';

export const runtime = 'nodejs';

/** 用户提交付款申请：仅记录，等待管理员确认后才加天数 */
export async function POST(req: Request) {
  const phone = phoneFromCookieHeader(req.headers.get('cookie'));
  if (!phone) return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
  const r = requestTopup(phone);
  if (!r.success) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ success: true, message: '已提交付款申请，等待管理员确认后到账' });
}
