import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';

/**
 * 动态推广激活码（有状态密钥库）：
 * - 管理员在主页「密钥管理」中按手机号签发密钥（写入服务端密钥库）；
 * - 使用人输入密钥验证：匹配未使用密钥 → +30 天，并立即标记为已使用（不可重复使用）；
 * - 密钥绑定手机号，仅对该手机号账号有效。
 */

/** 管理员手机号：仅该手机号登录可见管理员模块（白名单管理 / 密钥管理） */
export const ADMIN_PHONE = '16621121141';

export function isAdmin(phone: string | null | undefined): boolean {
  return !!phone && phone === ADMIN_PHONE;
}

export function keySecret(): string {
  return process.env.KEY_SECRET || '';
}

function dataDir(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'XMaxTV-desktop');
  return path.join(process.cwd(), 'data');
}

const KEYS_FILE = path.join(dataDir(), 'keys.json');

export interface KeyRecord {
  code: string;
  phone: string;
  status: 'unused' | 'used';
  createdAt: number;
  usedAt?: number;
}

function loadKeys(): Record<string, KeyRecord[]> {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')) as Record<string, KeyRecord[]>;
  } catch {
    return {};
  }
}

function saveKeys(keys: Record<string, KeyRecord[]>): void {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

/** 规范化输入：去掉连字符 / 空格，转大写 */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** 管理员签发密钥（写入密钥库，状态 unused） */
export function issueKey(phone: string): { success: boolean; code?: string; error?: string } {
  if (!/^1\d{10}$/.test(phone)) return { success: false, error: '手机号格式不正确，请输入 11 位手机号' };
  const secret = keySecret();
  if (!secret) return { success: false, error: '服务器未配置密钥，请设置 KEY_SECRET' };
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`xmaxtv:${phone}:${Date.now()}:${Math.random().toString(36).slice(2)}`)
    .digest('hex');
  let s = '';
  for (const ch of digest) {
    if (!/^[0-9A-Fa-f]$/.test(ch)) continue;
    const c = ch.toUpperCase();
    if ('01IL'.includes(c)) continue;
    s += c;
    if (s.length >= 12) break;
  }
  const code = `XMAX-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  const keys = loadKeys();
  if (!keys[phone]) keys[phone] = [];
  keys[phone].push({ code, phone, status: 'unused', createdAt: Date.now() });
  saveKeys(keys);
  return { success: true, code };
}

/** 验证并使用密钥：匹配该手机号的未使用密钥 → 标记已使用（一次有效） */
export function consumeKey(phone: string, code: string): { success: boolean; error?: string } {
  const normalized = normalizeCode(code);
  const keys = loadKeys();
  const list = keys[phone];
  if (!list || list.length === 0) return { success: false, error: '激活码无效，请核对后重试' };
  const found = list.find((k) => normalizeCode(k.code) === normalized);
  if (!found) return { success: false, error: '激活码无效，请核对后重试' };
  if (found.status === 'used') return { success: false, error: '该激活码已使用过，无法重复使用' };
  found.status = 'used';
  found.usedAt = Date.now();
  saveKeys(keys);
  return { success: true };
}

/** 密钥列表（管理员查看，含已使用标注） */
export function listKeys(): { phone: string; code: string; status: string; createdAt: number; usedAt?: number }[] {
  const keys = loadKeys();
  const out: { phone: string; code: string; status: string; createdAt: number; usedAt?: number }[] = [];
  for (const [phone, list] of Object.entries(keys)) {
    for (const k of list) {
      out.push({ phone, code: k.code, status: k.status, createdAt: k.createdAt, usedAt: k.usedAt });
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
