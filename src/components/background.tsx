'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { SectionTitle } from './settings-shared';

/**
 * 自定义背景图片：用户可在设置中上传一张图片作为系统背景（覆盖默认浅色/深色背景）。
 * 图片以 dataURL 存于 localStorage（上限 2MB，base64 后约 2.7MB，安全避开 5MB 配额），
 * 并在 body 上设置 background-image + data-custom-bg 标记；CSS 通过该标记叠加半透明遮罩保证文字可读。
 * 「恢复系统默认」清除存储与 body 上的自定义背景，回到主题默认背景。
 */

const BG_STORAGE_KEY = 'XMaxTV-bg';
const MAX_BG_BYTES = 2 * 1024 * 1024; // 2MB

interface BackgroundConteXMaxTValue {
  background: string | null;
  applyFile: (file: File) => Promise<void>;
  reset: () => void;
}

const BackgroundContext = createContext<BackgroundConteXMaxTValue>({
  background: null,
  applyFile: async () => {},
  reset: () => {},
});

export function useBackground(): BackgroundConteXMaxTValue {
  return useContext(BackgroundContext);
}

function applyToBody(dataUrl: string | null) {
  const body = document.body;
  if (dataUrl) {
    body.dataset.customBg = '1';
    body.style.backgroundImage = `url("${dataUrl}")`;
  } else {
    delete body.dataset.customBg;
    body.style.backgroundImage = '';
  }
}

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [background, setBackground] = useState<string | null>(null);

  // 挂载后恢复已保存的背景（避免 SSR/hydration 差异：首屏由内联脚本只处理主题，背景在客户端挂载后应用）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BG_STORAGE_KEY);
      if (saved) {
        setBackground(saved);
        applyToBody(saved);
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, []);

  const applyFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('请选择图片文件（JPG / PNG / WebP）');
    }
    if (file.size > MAX_BG_BYTES) {
      throw new Error('图片不能超过 2MB');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    try {
      localStorage.setItem(BG_STORAGE_KEY, dataUrl);
    } catch {
      throw new Error('图片过大，无法保存到本地存储');
    }
    setBackground(dataUrl);
    applyToBody(dataUrl);
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(BG_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setBackground(null);
    applyToBody(null);
  }, []);

  return (
    <BackgroundContext.Provider value={{ background, applyFile, reset }}>{children}</BackgroundContext.Provider>
  );
}

/** 设置面板：上传自定义背景图片 / 恢复系统默认 */
export function BackgroundPanel() {
  const { background, applyFile, reset } = useBackground();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      await applyFile(file);
      setMsg('背景已更新');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '设置失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="自定义背景"
        hint="上传一张图片作为系统背景（JPG / PNG / WebP，≤2MB）。白天浅色 / 夜晚深色主题均会保留半透明遮罩，保证文字可读。"
      />

      {background ? (
        <div className="rounded-lg overflow-hidden border border-line h-32 bg-cover bg-center" style={{ backgroundImage: `url("${background}")` }} />
      ) : (
        <div className="rounded-lg border border-dashed border-line h-24 flex items-center justify-center text-muted text-sm">
          未设置自定义背景（使用主题默认背景）
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-on-accent text-sm font-medium cursor-pointer hover:bg-accent-hover transition-colors">
          {busy ? '处理中…' : '上传图片'}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={onPick} />
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-sm text-content hover:bg-hover transition-colors"
          onClick={() => {
            reset();
            setMsg('已恢复系统默认背景');
          }}
        >
          恢复系统默认
        </button>
      </div>

      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
