'use client';

import { useEffect, useState } from 'react';

/**
 * 运行时区分「桌面应用端（Electron 壳）」与「网页端（手机/桌面浏览器）」。
 *
 * - 桌面端 UA 含 `Electron` 标识；纯浏览器访问（含公网部署的网页版）不含。
 * - 返回三态：`null`（SSR/未判定）→ `false`（网页端）或 `true`（桌面端），
 *   桌面专属内容用 `=== true` 才渲染，避免首帧闪烁与 hydration 不一致。
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    setIsDesktop(typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent));
  }, []);
  return isDesktop;
}
