import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { extendAccountByPhone, LICENSE_DAYS } from './account';

/**
 * 充值确认制：
 * - 用户扫码付款后点击“我已付款”，仅提交一条待确认记录（不直接加天数）；
 * - 管理员在「充值确认」模块查看待确认手机号，点确认后才给该账号 +30 天；
 * - 也可拒绝。记录保留便于追溯。
 */

export type TopupStatus = 'pending' | 'confirmed' | 'rejected';

export interface TopupRecord {
  id: string;
  phone: string;
  createdAt: number;
  status: TopupStatus;
  confirmedAt?: number;
  days: number;
}

function dataDir(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'XMaxTV-desktop');
  return path.join(process.cwd(), 'data');
}

const TOPUP_FILE = path.join(dataDir(), 'topups.json');

function load(): Record<string, TopupRecord[]> {
  try {
    const raw = fs.readFileSync(TOPUP_FILE, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(raw) as Record<string, TopupRecord[]>;
  } catch {
    return {};
  }
}

function save(data: Record<string, TopupRecord[]>): void {
  fs.mkdirSync(path.dirname(TOPUP_FILE), { recursive: true });
  fs.writeFileSync(TOPUP_FILE, JSON.stringify(data, null, 2));
}

/** 用户提交付款请求（同手机号有待确认记录时不重复提交） */
export function requestTopup(phone: string): { success: boolean; error?: string } {
  if (!/^1\d{10}$/.test(phone)) return { success: false, error: '手机号格式不正确' };
  const data = load();
  const list = data[phone] ?? [];
  if (list.some((r) => r.status === 'pending')) {
    return { success: false, error: '已有待确认的充值申请，请等待管理员确认' };
  }
  const id = crypto.randomBytes(6).toString('hex');
  list.push({ id, phone, createdAt: Date.now(), status: 'pending', days: LICENSE_DAYS });
  data[phone] = list;
  save(data);
  return { success: true };
}

/** 管理员查看全部充值记录（新的在前） */
export function listTopups(): TopupRecord[] {
  const data = load();
  const out: TopupRecord[] = [];
  for (const list of Object.values(data)) out.push(...list);
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** 管理员确认：给该手机号 +30 天，标记已确认 */
export function confirmTopup(id: string): { success: boolean; error?: string } {
  const data = load();
  for (const list of Object.values(data)) {
    const rec = list.find((r) => r.id === id);
    if (!rec) continue;
    if (rec.status === 'confirmed') return { success: false, error: '该申请已确认' };
    const r = extendAccountByPhone(rec.phone, rec.days);
    if (!r.success) return r;
    rec.status = 'confirmed';
    rec.confirmedAt = Date.now();
    save(data);
    return { success: true };
  }
  return { success: false, error: '未找到该申请' };
}

/** 管理员拒绝：标记已拒绝（不加天数） */
export function rejectTopup(id: string): { success: boolean; error?: string } {
  const data = load();
  for (const list of Object.values(data)) {
    const rec = list.find((r) => r.id === id);
    if (!rec) continue;
    rec.status = 'rejected';
    save(data);
    return { success: true };
  }
  return { success: false, error: '未找到该申请' };
}
