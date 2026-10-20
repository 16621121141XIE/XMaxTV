import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { consumeKey, isAdmin } from './keys';
import { isWhitelisted, WHITELIST_DAYS } from './whitelist';
import { getSettings } from './settings';

/**
 * 三端互通账号 + 授权系统（桌面端 / 手机浏览器 / 小米电视共用同一账号与剩余时间）。
 * 账号与授权到期时间保存在服务端本地文件，登录同一手机号即共享剩余时间。
 * 白名单账号：剩余时间固定 9999 天（永久免费）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const LICENSE_DAYS = 30;   // 每次激活/续期增加的天数
export const PAY_AMOUNT = 5;      // 每 30 天 5 元

function dataDir(): string {
  // 桌面端：%APPDATA%\XMaxTV-desktop（卸载时一并清理）
  // 其他环境（网页部署 / TV APK）：当前工作目录下的 data/
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'XMaxTV-desktop');
  return path.join(process.cwd(), 'data');
}

const USERS_FILE = path.join(dataDir(), 'users.json');

export interface Account {
  phone: string;
  salt: string;
  passwordHash: string;
  activated: boolean; // 是否已用推广授权码激活
  expiresAt: number;  // 授权到期时间戳（ms），0 = 未激活
  createdAt: number;
}

function loadAccounts(): Record<string, Account> {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(raw) as Record<string, Account>;
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, Account>): void {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(accounts, null, 2));
}

function hashPw(password: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

/** 注册：手机号 + 密码（手机号仅作账号标识，无需短信验证） */
export function registerAccount(phone: string, password: string) {
  const accounts = loadAccounts();
  if (!/^1\d{10}$/.test(phone)) return { success: false, error: '手机号格式不正确，请输入 11 位手机号' };
  if (password.length < 4) return { success: false, error: '密码至少 4 位' };
  if (accounts[phone]) return { success: false, error: '该手机号已注册，请直接登录' };
  const salt = crypto.randomBytes(8).toString('hex');
  accounts[phone] = {
    phone,
    salt,
    passwordHash: hashPw(password, salt),
    activated: false,
    expiresAt: 0,
    createdAt: Date.now(),
  };
  saveAccounts(accounts);
  return { success: true };
}

/** 登录：手机号 + 密码 */
export function loginAccount(phone: string, password: string) {
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { success: false, error: '手机号未注册，请先注册' };
  if (acc.passwordHash !== hashPw(password, acc.salt)) return { success: false, error: '密码错误' };
  return { success: true, account: acc };
}

/** 激活（固定推广授权码，仅首次可用）：输入推广授权码，获得 30 天 */
export function activateAccount(phone: string, code: string) {
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { success: false, error: '账号不存在' };
  const expected = process.env.PASSWORD || process.env.LICENSE_CODE || '';
  if (!expected) return { success: false, error: '服务器未配置推广授权码' };
  if (acc.activated) return { success: false, error: '已激活过，固定授权码仅首次可用，请使用激活码或付款续期' };
  if (code.trim() !== expected) return { success: false, error: '推广授权码错误' };
  acc.activated = true;
  acc.expiresAt = Math.max(Date.now(), acc.expiresAt) + LICENSE_DAYS * DAY_MS;
  saveAccounts(accounts);
  return { success: true, expiresAt: acc.expiresAt };
}

/** 动态激活码续期：密钥验证成功即视为一次付款成功，+30 天；密钥仅可使用一次 */
export function activateByCode(phone: string, code: string) {
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { success: false, error: '账号不存在' };
  const r = consumeKey(phone, code);
  if (!r.success) return r;
  acc.activated = true;
  acc.expiresAt = Math.max(Date.now(), acc.expiresAt) + LICENSE_DAYS * DAY_MS;
  saveAccounts(accounts);
  return { success: true, expiresAt: acc.expiresAt };
}

/** 续期：付款确认后 +30 天（简单模式：点击“我已付款”） */
export function renewAccount(phone: string) {
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { success: false, error: '账号不存在，请先注册登录' };
  acc.expiresAt = Math.max(Date.now(), acc.expiresAt) + LICENSE_DAYS * DAY_MS;
  acc.activated = true;
  saveAccounts(accounts);
  return { success: true, expiresAt: acc.expiresAt };
}

/** 管理员确认充值：给指定手机号 +days 天（账号不存在则提示先注册） */
export function extendAccountByPhone(phone: string, days: number = LICENSE_DAYS) {
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { success: false, error: '该手机号未注册，请先注册登录' };
  acc.expiresAt = Math.max(Date.now(), acc.expiresAt) + days * DAY_MS;
  acc.activated = true;
  saveAccounts(accounts);
  return { success: true, expiresAt: acc.expiresAt };
}

/** 账号授权状态（白名单账号固定 9999 天；商业模式关闭时不校验，30 天不扣减） */
export function accountStatus(phone: string) {
  if (isWhitelisted(phone)) {
    return {
      activated: true,
      expired: false,
      remainingDays: WHITELIST_DAYS,
      expiresAt: Number.MAX_SAFE_INTEGER,
      whitelisted: true,
    };
  }
  // 管理员账号：免激活、不限期（用于管理密钥/白名单/商业模式开关）
  if (isAdmin(phone)) {
    return {
      activated: true,
      expired: false,
      remainingDays: WHITELIST_DAYS,
      expiresAt: Number.MAX_SAFE_INTEGER,
      whitelisted: false,
      unrestricted: true,
    };
  }
  // 商业模式关闭（默认）：前期永久免费、不扣减剩余时间；前端统一显示"当前免费阶段"，不展示天数与付费入口。
  if (!getSettings().commercialMode) {
    return {
      activated: true,
      expired: false,
      remainingDays: 0,
      expiresAt: 0,
      whitelisted: false,
      unrestricted: false,
    };
  }
  const accounts = loadAccounts();
  const acc = accounts[phone];
  if (!acc) return { activated: false, expired: false, remainingDays: 0, expiresAt: 0, whitelisted: false };
  const remaining = acc.expiresAt - Date.now();
  return {
    activated: acc.activated,
    expired: acc.activated && remaining <= 0,
    remainingDays: acc.activated ? Math.max(0, Math.ceil(remaining / DAY_MS)) : 0,
    expiresAt: acc.expiresAt,
    whitelisted: false,
  };
}
