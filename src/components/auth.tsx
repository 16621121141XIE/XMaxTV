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
  /** 重新拉取 /api/status，刷新登录态、账号、商业模式开关（管理员切换开关后即时生效） */
  refreshStatus: () => Promise<void>;
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
  refreshStatus: async () => {},
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
  // 用 ref 跟踪商业模式开关，供全局 401/503 回调读取最新值（回调仅注册一次）
  const commercialModeRef = useRef(false);
  useEffect(() => {
    commercialModeRef.current = commercialMode;
  }, [commercialMode]);

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
        // 商业模式关闭（游客模式）：公开内容已由服务端放行，个别账号接口的 401 不强制弹登录框
        if (commercialModeRef.current) setModalOpen(true);
      }),
    []
  );

  const openLogin = useCallback(() => setModalOpen(true), []);

  // 重新拉取 /api/status：管理员切换商业模式开关后，全局即时更新（游客入口显隐、登录态）
  const refreshStatus = useCallback(async () => {
    try {
      const s = await queryClient.fetchQuery<AuthStatusResponse>({
        queryKey: STATUS_QUERY_KEY,
        queryFn: () => api.status(),
        staleTime: 0,
      });
      setVerified(s.verified);
      setSetupRequired(!s.passwordRequired);
      setVersion(s.version);
      setAccount(s.account ?? { loggedIn: false });
      setCommercialMode(s.commercialMode);
    } catch {
      /* 刷新失败不阻塞 */
    }
  }, [queryClient]);

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
      value={{ checked, verified, setupRequired, version, account, commercialMode, openLogin, logout, refreshStatus }}
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
  const { toast } = useToast();
  const { logout } = useAuth();
  // 已登录且授权正常（已激活、未过期）：点账号按钮只看账号信息，可直接关闭继续使用，不强制重新登录
  const healthy = !!account.loggedIn && !!account.activated && !account.expired;
  // 可关闭弹框：健康账号、或商业模式关闭（游客/非强制场景）；强制登录态点遮罩/取消不关闭
  const canDismiss = healthy || !commercialMode;
  const closeIfAllowed = () => {
    if (canDismiss) onClose();
  };
  // 登录成功后切到对应步骤（激活/付款/关闭），再交给 onSuccess 刷新全局状态
  const navigate = async (target: 'none' | 'activate' | 'pay') => {
    setStep(target === 'none' ? 'login' : target);
    await onSuccess(target);
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (canDismiss) onClose();
      }}
    >
      <div
        className="bg-surface-raised rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={step === 'pay' ? '授权续期' : step === 'activate' ? '激活授权' : healthy ? '账号信息' : '账号登录'}
        onClick={(e) => e.stopPropagation()}
      >
        {setupRequired ? (
          <>
            <h2 className="text-lg font-semibold text-content mb-3">需要配置授权码</h2>
            <p className="text-sm text-muted leading-relaxed">
              为确保安全，必须设置 <code className="text-accent">PASSWORD</code>（推广授权码）环境变量才能使用本服务。
              请联系管理员配置后重启服务。
            </p>
          </>
        ) : healthy && step === 'login' ? (
          <AccountPanel
            account={account}
            onClose={onClose}
            onLogout={() => void logout()}
            onGoActivate={() => setStep('activate')}
            onGoPay={() => setStep('pay')}
          />
        ) : step === 'login' ? (
          <LoginForm commercialMode={commercialMode} onClose={onClose} onNext={navigate} onGoActivate={() => setStep('activate')} />
        ) : step === 'activate' ? (
          <ActivateForm onSuccess={onSuccess} onBack={() => setStep('login')} onGoPay={() => setStep('pay')} onClose={closeIfAllowed} />
        ) : (
          <PayForm onSuccess={onSuccess} onBack={() => setStep('activate')} onClose={closeIfAllowed} />
        )}
      </div>
    </div>
  );
}

/** 已登录且授权正常：账号信息卡片，可直接关闭继续使用，或续费/激活/退出切换 */
function AccountPanel({
  account,
  onClose,
  onLogout,
  onGoActivate,
  onGoPay,
}: {
  account: AccountStatus;
  onClose: () => void;
  onLogout: () => void;
  onGoActivate: () => void;
  onGoPay: () => void;
}) {
  const { commercialMode } = useAuth();
  // 商业模式关闭（前期免费阶段）：所有用户都不显示充值/激活入口，剩余时间统一显示"当前免费阶段"；
  // 仅商业模式开启后，普通用户才展示充值续费 / 推广码激活（管理员、白名单永久免费仍隐藏）。
  const showBilling = commercialMode && !(account.whitelisted || account.unrestricted);
  return (
    <>
      <h2 className="text-lg font-semibold text-content mb-3">当前账号</h2>
      <div className="px-3 py-3 rounded-md bg-hover/60 border border-line mb-4">
        <div className="flex items-center justify-between text-sm text-content">
          <span>手机号</span>
          <span className="font-medium">{maskPhone(account.phone)}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-muted mt-2">
          <span>会员状态</span>
          <span className="text-accent font-medium">
            {!commercialMode
              ? '当前免费阶段'
              : typeof account.remainingDays === 'number'
                ? account.remainingDays >= 9999
                  ? '永久'
                  : `${account.remainingDays} 天`
                : '—'}
          </span>
        </div>
      </div>
      <button type="button" className="btn-primary w-full mb-2" onClick={onClose}>
        继续使用当前账号
      </button>
      {/* 仅商业模式开启时，普通用户显示充值续费 / 推广码激活；管理员、白名单及免费阶段均隐藏 */}
      {showBilling && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            className="py-2 rounded-md border border-line text-sm text-content hover:bg-hover transition-colors"
            onClick={onGoPay}
          >
            充值续费
          </button>
          <button
            type="button"
            className="py-2 rounded-md border border-line text-sm text-content hover:bg-hover transition-colors"
            onClick={onGoActivate}
          >
            推广码激活
          </button>
        </div>
      )}
      <button
        type="button"
        className="w-full py-2 rounded-md border border-line text-sm text-muted hover:bg-hover transition-colors"
        onClick={onLogout}
      >
        退出并切换账号
      </button>
    </>
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
  const { toast } = useToast();

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
      toast(mode === 'register' ? '注册成功，已自动登录' : '登录成功', 'success');
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
  onClose,
}: {
  onSuccess: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onBack: () => void;
  onGoPay: () => void;
  onClose: () => void;
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
      <button type="button" className="w-full mt-3 text-center text-sm text-muted hover:text-content" onClick={onClose}>
        取消，关闭窗口
      </button>
    </>
  );
}

function PayForm({
  onSuccess,
  onBack,
  onClose,
}: {
  onSuccess: (keepOpen: 'none' | 'activate' | 'pay') => Promise<void>;
  onBack: () => void;
  onClose: () => void;
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
      // 付款仅提交申请，由管理员在「充值确认」中核对后手动 +30 天
      await api.submitTopup();
      await onSuccess('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-content mb-1">授权已到期，请续期</h2>
      <p className="text-sm text-muted mb-3">输入激活码免费续期，或扫码付款后提交申请，由管理员确认后增加 30 天</p>

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
        {loading ? '提交中...' : '我已付款，提交申请（待管理员确认）'}
      </button>
      <div className="flex justify-between mt-3 text-sm">
        <button type="button" className="text-muted hover:text-content" onClick={onBack}>
          返回输入授权码
        </button>
      </div>
      <button type="button" className="w-full mt-3 text-center text-sm text-muted hover:text-content" onClick={onClose}>
        取消，关闭窗口
      </button>
    </>
  );
}
