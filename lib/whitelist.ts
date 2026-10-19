import fs from 'fs';
import path from 'path';

/**
 * 白名单机制：管理员录入手机号后，该账号授权变为 9999 天（永久免费）。
 */

export const WHITELIST_DAYS = 9999;

function dataDir(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'XMaxTV-desktop');
  return path.join(process.cwd(), 'data');
}

const WHITELIST_FILE = path.join(dataDir(), 'whitelist.json');

export function loadWhitelist(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf-8'));
    return Array.isArray(data) ? data.map(String) : [];
  } catch {
    return [];
  }
}

function saveWhitelist(list: string[]): void {
  fs.mkdirSync(path.dirname(WHITELIST_FILE), { recursive: true });
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2));
}

export function isWhitelisted(phone: string): boolean {
  return loadWhitelist().includes(phone);
}

/** 录入白名单（对应用户剩余时间变为 9999 天） */
export function addWhitelist(phone: string): { success: boolean; error?: string } {
  if (!/^1\d{10}$/.test(phone)) return { success: false, error: '手机号格式不正确，请输入 11 位手机号' };
  const list = loadWhitelist();
  if (!list.includes(phone)) {
    list.push(phone);
    saveWhitelist(list);
  }
  return { success: true };
}

/** 移出白名单 */
export function removeWhitelist(phone: string): { success: boolean; error?: string } {
  const list = loadWhitelist();
  const idx = list.indexOf(phone);
  if (idx >= 0) {
    list.splice(idx, 1);
    saveWhitelist(list);
  }
  return { success: true };
}
