import fs from 'fs';
import path from 'path';

/**
 * 全局业务设置（管理员可配置）：
 * - commercialMode：是否启用商业模式（默认关闭）。
 *   关闭 = 前期永久免费，不校验剩余时间（剩余 30 天不扣减）；
 *   开启 = 校验剩余时间，30 天倒计时，到期需激活码 / 付款续期。
 */

export interface AppSettings {
  commercialMode: boolean;
}

function dataDir(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'XMaxTV-desktop');
  return path.join(process.cwd(), 'data');
}

const SETTINGS_FILE = path.join(dataDir(), 'settings.json');

const DEFAULT_SETTINGS: AppSettings = { commercialMode: false };

export function getSettings(): AppSettings {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as Partial<AppSettings>;
    return { commercialMode: typeof data.commercialMode === 'boolean' ? data.commercialMode : false };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setCommercialMode(enabled: boolean): AppSettings {
  const settings = getSettings();
  settings.commercialMode = enabled;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return settings;
}
