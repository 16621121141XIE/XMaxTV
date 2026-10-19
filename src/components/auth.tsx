'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import type { AccountStatus, AuthStatusResponse } from '@/lib/types';
import { useToast } from './toast';

/**
 * 认证上下文（三端互通账号）：
 * - 手机号 + 密码 注册 / 登录，登录成功写入会话 cookie；
 * - 首次登录需输入「推广授权码」激活，获得 30 天；
 * - 到期后弹出付款页（支付宝/微信收款码），确认付款后自动续期 30 天；
 * - 任何 API 返回 401/503 时全局打开登录框；
 * - 商业模式关闭（默认）：支持游客模式，不强制登录，游客直接进入观看；
 * - 商业模式开启：必须手机号登录，隐藏游客入口。
 */

interface AuthConteXMaxTValue {
  checked: boolean;
  verified: boolean;
  /** 服务器未设置 PASSWORD，需要管理员配置 */
  setupRequired: boolean;
  /** /api/status 返回的应用版本 */
  version: string | null;
  /** 三端互通账号状态 */
  account: AccountStatus;
  /** 商业模式开关：关闭=游客可直接观看；开启=必须登录并校验剩余时间 */
  commercialMode: boolean;
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthConteXMaxTValue>({
  checked: false,
  verified: false,
  setupRequired: false,
  version: null,
  account: { loggedIn: false },
  commercialMode: false,
  openLogin: () => {},
  logout: async () => {},
});

export function useAuth(): AuthConteXMaxTValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [verified, setVerified] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountStatus>({ loggedIn: false });
  const [commercialMode, setCommercialMode] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 与 Providers 共用同一 query key 与缓存，避免 /api/status 被请求两次
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((s) => {
        if (cancelled) return;
        setVerified(s.verified);
        setSetupRequired(!s.passwordRequired);
        setVersion(s.version);
        setAccount(s.account ?? { loggedIn: false });
        setCommercialMode(s.commercialMode);
        setChecked(true);
        // 商业模式关闭（默认）：游客模式，不强制登录，未登录不弹框直接进入
        // 商业模式开启：未登录需弹登录框；已登录但未激活/过期弹授权框
        if (s.commercialMode) {
          if (!s.account?.loggedIn) {
            setModalOpen(true);
          } else if (!s.account.activated || s.account.expired) {
            setModalOpen(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(
    () =>
      onUnauthorized((event) => {
        const setup = (event as CustomEvent).detail === 'setup';
        setSetupRequired(setup);
        setVerified(false);
        setModalOpen(true);
      }),
    []
  );

  const openLogin = useCallback(() => setModalOpen(true), []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setVerified(false);
      setAccount({ loggedIn: false });
      toast('已退出登录', 'info');
    }
  }, [toast]);

  /** 登录 / 激活 / 续期成功后统一收口：刷新账号状态，按需保持弹框 */
  const handleSuccess = useCallback(
    async (keepOpen: 'none' | 'activate' | 'pay') => {
      try {
        const s = await queryClient.fetchQuery<AuthStatusResponse>({
          queryKey: STATUS_QUERY_KEY,
          queryFn: () => api.status(),
          staleTime: 0,
        });
        setVerified(s.verified);
        setAccount(s.account ?? { loggedIn: false });
        setSetupRequired(!s.passwordRequired);
      } catch {
        // 状态刷新失败不阻塞
      }
      if (keepOpen !== 'none') {
        setModalOpen(true);
        return;
      }
      setModalOpen(false);
      queryClient.invalidateQueries();
      toast('操作成功', 'success');
      // 预置订阅（DEFAULT_SUBSCRIPTIONS）的首屏同步
      try {
        const cached = queryClient.getQueryData<AuthStatusResponse>(STATUS_QUERY_KEY);
        const status =
          cached ??
          (await queryClient.fetchQuery<AuthStatusResponse>({
            queryKey: STATUS_QUERY_KEY,
            queryFn: () => api.status(),
            staleTime: 0,
          }));
        if (status) await applyEnvPresets(status);
      } catch {
        // 补拉预置数据失败不影响正常使用
      }
    },
    [toast, queryClient]
  );

  return (
    <AuthContext.Provider
      value={{ checked, verified, setupRequired, version, account, commercialMode, openLogin, logout }}
    >
      {children}
      {modalOpen && (
        <LoginModal
          setupRequired={setupRequired}
          account={account}
          commercialMode={commercialMode}
          onSuccess={handleSuccess}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AuthContext.Provider>
  );
}

type Step = 'login' | 'activate' | 'pay';

/** 手机号打码展示：16621121141 → 166****1141 */
function maskPhone(p?: string): string {
  if (!p) return '';
  return p.length >= 7 ? `${p.slice(0, 3)}****${p.slice(-4)}` : p;
}

function LoginModal({
  setupRequired,
  account,
  commercialMode,
  onSuccess,
  onClose,
}: {
  setupRequired: boolean;
  account: AccountStatus;
  commercialMode: boolean;
  onSuccess: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(() => {
    if (account.loggedIn && account.expired) return 'pay';
    if (account.loggedIn && !account.activated) return 'activate';
    return 'login';
  });
  const { logout } = useAuth();

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface-raised rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={step === 'pay' ? '授权续期' : step === 'activate' ? '激活授权' : '账号登录'}
      >
        {/* 已登录：显示当前账号，支持退出并切换账号 */}
        {account.loggedIn && (
          <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-md bg-hover/60 border border-line text-xs text-muted">
            <span>当前账号：{maskPhone(account.phone)}</span>
            <button
              type="button"
              className="text-accent hover:underline shrink-0 ml-2"
              onClick={() => {
                void logout();
              }}
            >
              退出并切换账号
            </button>
          </div>
        )}
        {setupRequired ? (
          <>
            <h2 className="text-lg font-semibold text-content mb-3">需要配置授权码</h2>
            <p className="text-sm text-muted leading-relaxed">
              为确保安全，必须设置 <code className="text-accent">PASSWORD</code>（推广授权码）环境变量才能使用本服务。
              请联系管理员配置后重启服务。
            </p>
          </>
        ) : step === 'login' ? (
          <LoginForm commercialMode={commercialMode} onClose={onClose} onNext={onSuccess} onGoActivate={() => setStep('activate')} />
        ) : step === 'activate' ? (
          <ActivateForm onSuccess={onSuccess} onBack={() => setStep('login')} onGoPay={() => setStep('pay')} />
        ) : (
          <PayForm onSuccess={onSuccess} onBack={() => setStep('activate')} />
        )}
      </div>
    </div>
  );
}

function LoginForm({
  commercialMode,
  onClose,
  onNext,
  onGoActivate,
}: {
  commercialMode: boolean;
  onClose: () => void;
  onNext: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onGoActivate: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    phoneRef.current?.focus();
    // 记住上次登录手机号，避免每次重复输入
    try {
      const last = localStorage.getItem('XMaxTV-last-phone');
      if (last) setPhone(last);
    } catch {
      /* 隐私模式等无法读写时忽略 */
    }
  }, []);

  const submit = async () => {
    if (!phone.trim() || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      // 记住当前设备登录手机号（切换账号时可快速回填）
      try {
        localStorage.setItem('XMaxTV-last-phone', phone.trim());
      } catch {
        /* 忽略 */
      }
      await api.accountLogin(mode, phone.trim(), password);
      // 登录成功：查询授权状态决定下一步（商业模式关闭时直接进入，不校验）
      const s = await api.status();
      const acc = s.account ?? { loggedIn: false };
      if (!s.commercialMode) {
        await onNext('none');
      } else if (acc.loggedIn && acc.expired) {
        await onNext('pay');
      } else if (acc.loggedIn && !acc.activated) {
        await onNext('activate');
      } else {
        await onNext('none');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败';
      setError(msg === '需要登录' ? '手机号或密码错误' : msg);
      setPassword('');
      phoneRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-content">{mode === 'login' ? '账号登录' : '注册账号'}</h2>
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </div>
      <p className="text-sm text-muted mb-4">手机号登录，桌面 / 手机 / 电视三端共用剩余时间</p>
      {/* 商业模式关闭：游客模式入口（开启商业模式后隐藏，必须登录） */}
      {!commercialMode && (
        <button
          type="button"
          className="w-full mb-3 py-2 rounded-md border border-line text-sm text-content hover:bg-hover transition-colors"
          onClick={onClose}
        >
          游客模式直接观看
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={phoneRef}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input w-full mb-3"
          placeholder="手机号"
          autoComplete="tel"
          inputMode="numeric"
          maxLength={11}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-full"
          placeholder={mode === 'login' ? '密码' : '设置密码（至少 4 位）'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !phone.trim() || !password}>
          {loading ? '处理中...' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>
      <button
        type="button"
        className="w-full mt-3 text-center text-sm text-muted hover:text-content"
        onClick={onGoActivate}
      >
        已有推广授权码？直接激活
      </button>
    </>
  );
}

function ActivateForm({
  onSuccess,
  onBack,
  onGoPay,
}: {
  onSuccess: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onBack: () => void;
  onGoPay: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.licenseActivate(code.trim());
      await onSuccess('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败');
      setCode('');
      codeRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-content mb-1">请输入推广授权码</h2>
      <p className="text-sm text-muted mb-4">激活后获得 30 天使用时长，倒计时结束后需重新激活或续费</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={codeRef}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="input w-full"
          placeholder="推广授权码"
          autoComplete="off"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !code.trim()}>
          {loading ? '激活中...' : '激活（30 天）'}
        </button>
      </form>
      <div className="flex justify-between mt-3 text-sm">
        <button type="button" className="text-muted hover:text-content" onClick={onBack}>
          返回登录
        </button>
        <button type="button" className="text-accent hover:underline" onClick={onGoPay}>
          直接付费续期
        </button>
      </div>
    </>
  );
}

function PayForm({
  onSuccess,
  onBack,
}: {
  onSuccess: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submitCode = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.licenseActivateByCode(code.trim());
      await onSuccess('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败');
      setLoading(false);
    }
  };

  const confirmPaid = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await api.licenseRenew();
      await onSuccess('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : '续期失败');
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-content mb-1">授权已到期，请续期</h2>
      <p className="text-sm text-muted mb-3">输入激活码免费续期，或扫码付款后自动增加 30 天</p>

      {/* 动态激活码（密钥生成器验证，等同一次付款成功） */}
      <div className="mb-4">
        <p className="text-xs text-muted mb-1">有激活码？输入后直接续期 30 天，无需付款</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input flex-1"
            placeholder="激活码（如 XMAX-XXXX-XXXX-XXXX）"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitCode();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary shrink-0 px-3"
            onClick={submitCode}
            disabled={loading || !code.trim()}
          >
            {loading ? '验证中' : '验证并续期'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 my-3">
        <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
        <span className="text-xs text-muted">或扫码付款 ¥5</span>
        <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-lg p-2 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pay/alipay.jpg" alt="支付宝收款码" className="w-full rounded-md" />
          <span className="text-xs text-slate-600 mt-1">支付宝</span>
        </div>
        <div className="bg-white rounded-lg p-2 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pay/wechat.jpg" alt="微信收款码" className="w-full rounded-md" />
          <span className="text-xs text-slate-600 mt-1">微信</span>
        </div>
      </div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <button type="button" className="btn-primary w-full" onClick={confirmPaid} disabled={loading}>
        {loading ? '处理中...' : '我已付款，续期 30 天'}
      </button>
      <div className="flex justify-between mt-3 text-sm">
        <button type="button" className="text-muted hover:text-content" onClick={onBack}>
          返回输入授权码
        </button>
      </div>
    </>
  );
}
