'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * 主题上下文：light / dark / auto（自动），持久化到 localStorage，默认 auto。
 * auto 模式直接调用系统的白天/夜晚切换机制（prefers-color-scheme）：
 * 系统为浅色主题（白天）→ 浅色护眼白底；系统为深色主题（夜晚）→ 现有赛博深色背景。
 * 系统切换主题时实时跟随（监听 media query change），不设置固定时间。
 * html 上的 .dark 类由 layout 中的内联脚本先行设置（避免首屏闪烁），此处负责后续切换。
 */

export type ThemeChoice = 'light' | 'dark' | 'auto';
const STORAGE_KEY = 'XMaxTV-theme';

interface ThemeConteXMaxTValue {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeConteXMaxTValue>({
  theme: 'auto',
  resolved: 'light',
  setTheme: () => {},
});

export function useTheme(): ThemeConteXMaxTValue {
  return useContext(ThemeContext);
}

/** 系统当前是否为深色（夜晚）主题 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(choice: ThemeChoice): 'light' | 'dark' {
  const resolved = choice === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('auto');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) || 'auto';
    setThemeState(stored);
    setResolved(apply(stored));

    // 监听系统白天/夜晚切换：auto 模式下实时跟随系统主题变化
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const current = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) || 'auto';
      if (current === 'auto') {
        setResolved(apply('auto'));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    setResolved(apply(t));
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

/** 亮暗切换按钮：在 浅色 → 深色 → 自动（跟随系统昼夜） 三态间循环 */
export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const next: ThemeChoice = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light';
  const label = theme === 'auto' ? '自动（跟随系统昼夜）' : theme === 'dark' ? '深色' : '浅色';
  const nextLabel = next === 'light' ? '浅色' : next === 'dark' ? '深色' : '自动';

  return (
    <button
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={`主题：${label}，点击切换为${nextLabel}`}
      aria-label={`切换主题，当前 ${label}`}
      onClick={() => setTheme(next)}
    >
      {theme === 'auto' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {/* 自动（跟随系统昼夜）：半太阳半月亮 */}
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 15.5a6 6 0 01-7-7 6.003 6.003 0 106 7z" />
        </svg>
      ) : resolved === 'dark' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}
