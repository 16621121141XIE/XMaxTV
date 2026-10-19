'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import { useToast } from './toast';
import { SectionTitle, Switch } from './settings-shared';
import { copyToClipboard } from '@/lib/clipboard';

interface KeyItem {
  phone: string;
  code: string;
  status: string;
  createdAt: number;
  usedAt?: number;
}

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 商业模式开关（仅管理员可见） */
export function CommercialModeSection() {
  const { toast } = useToast();
  const [commercialMode, setCommercialMode] = useState(false);

  useEffect(() => {
    api
      .adminSettings()
      .then((r) => {
        if (r.success && r.settings) setCommercialMode(r.settings.commercialMode);
      })
      .catch(() => {});
  }, []);

  const toggle = async (next: boolean) => {
    setCommercialMode(next);
    try {
      const r = await api.adminSettingsSetCommercial(next);
      if (r.success && r.settings) {
        setCommercialMode(r.settings.commercialMode);
        toast(r.settings.commercialMode ? '商业模式已开启（校验 30 天剩余时间）' : '商业模式已关闭（免费使用，游客可直接观看）', 'success');
      } else {
        toast('设置失败', 'error');
        setCommercialMode(!next);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '设置失败', 'error');
      setCommercialMode(!next);
    }
  };

  return (
    <section>
      <SectionTitle title="商业模式" />
      <div className="p-3 rounded-lg bg-surface-raised/60 border border-line">
        <Switch
          checked={commercialMode}
          onChange={toggle}
          label="启用商业模式"
          title={
            commercialMode
              ? '开启：校验剩余时间，30 天倒计时，到期需激活码 / 付款续期；隐藏游客模式，必须登录'
              : '关闭（默认）：前期永久免费，不校验剩余时间；支持游客模式直接观看'
          }
        />
      </div>
    </section>
  );
}

/** 密钥管理（仅管理员可见）：按手机号签发一次性激活码 */
export function KeyManageSection() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [issuePhone, setIssuePhone] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.adminKeys();
      if (r.success && r.keys) setKeys(r.keys);
    } catch {
      /* 权限或网络异常时保持现状 */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const issue = async () => {
    const phone = issuePhone.trim();
    if (!phone || loading) return;
    setLoading(true);
    try {
      const r = await api.adminIssueKey(phone);
      if (r.success && r.code) {
        setNewCode(r.code);
        setIssuePhone('');
        await refresh();
        toast('密钥已生成', 'success');
      } else {
        toast(r.error || '生成失败', 'error');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '生成失败', 'error');
    }
    setLoading(false);
  };

  const copyCode = async () => {
    if (!newCode) return;
    await copyToClipboard(newCode);
    toast('已复制', 'success');
  };

  return (
    <section>
      <SectionTitle title="密钥管理" />
      <p className="text-xs text-muted mb-3">
        按手机号签发激活码：使用人输入后 +30 天，密钥验证成功后即失效（不可重复使用）
      </p>
      <div className="flex gap-2 mb-3">
        <input
          className="input flex-1"
          value={issuePhone}
          onChange={(e) => setIssuePhone(e.target.value)}
          placeholder="使用人手机号"
          inputMode="numeric"
          maxLength={11}
          onKeyDown={(e) => {
            if (e.key === 'Enter') issue();
          }}
        />
        <button type="button" className="btn-primary shrink-0 px-3" onClick={issue} disabled={loading || !issuePhone.trim()}>
          {loading ? '生成中' : '生成密钥'}
        </button>
      </div>

      {newCode && (
        <div className="mb-3 p-3 rounded-lg bg-accent/10 border border-accent/30">
          <p className="text-xs text-muted mb-1">新密钥（发给使用人）：</p>
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono text-accent break-all">{newCode}</code>
            <button type="button" className="text-xs text-accent hover:underline shrink-0" onClick={copyCode}>
              复制
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {keys.length === 0 && <p className="text-xs text-muted">暂无已签发的密钥</p>}
        {keys.map((k) => (
          <div
            key={k.code}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-raised/60 border border-line text-sm"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs text-content break-all">{k.code}</div>
              <div className="text-xs text-muted">
                {k.phone} · {fmtTime(k.createdAt)}
                {k.usedAt ? ` · 使用于 ${fmtTime(k.usedAt)}` : ''}
              </div>
            </div>
            <span
              className={
                k.status === 'used'
                  ? 'shrink-0 text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger'
                  : 'shrink-0 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success'
              }
            >
              {k.status === 'used' ? '已使用' : '未使用'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 白名单管理（仅管理员可见）：录入手机号后 9999 天永久免费 */
export function WhitelistSection() {
  const { toast } = useToast();
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [wlPhone, setWlPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.adminWhitelist();
      if (r.success && r.whitelist) setWhitelist(r.whitelist);
    } catch {
      /* 权限或网络异常时保持现状 */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    const phone = wlPhone.trim();
    if (!phone || loading) return;
    setLoading(true);
    try {
      const r = await api.adminWhitelistAdd(phone);
      if (r.success && r.whitelist) {
        setWhitelist(r.whitelist);
        setWlPhone('');
        toast('已加入白名单（9999 天）', 'success');
      } else {
        toast('操作失败', 'error');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    }
    setLoading(false);
  };

  const remove = async (phone: string) => {
    try {
      const r = await api.adminWhitelistRemove(phone);
      if (r.success && r.whitelist) {
        setWhitelist(r.whitelist);
        toast('已移出白名单', 'info');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    }
  };

  return (
    <section>
      <SectionTitle title="白名单管理" />
      <p className="text-xs text-muted mb-3">录入手机号后，对应用户剩余时间变为 9999 天（永久免费）</p>
      <div className="flex gap-2 mb-3">
        <input
          className="input flex-1"
          value={wlPhone}
          onChange={(e) => setWlPhone(e.target.value)}
          placeholder="手机号（11 位）"
          inputMode="numeric"
          maxLength={11}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="btn-primary shrink-0 px-3" onClick={add} disabled={loading || !wlPhone.trim()}>
          {loading ? '处理中' : '加入白名单'}
        </button>
      </div>

      <div className="space-y-1.5">
        {whitelist.length === 0 && <p className="text-xs text-muted">白名单为空</p>}
        {whitelist.map((p) => (
          <div
            key={p}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-raised/60 border border-line text-sm"
          >
            <span className="text-content">{p}</span>
            <span className="text-xs text-success shrink-0">9999 天</span>
            <button type="button" className="text-xs text-muted hover:text-danger shrink-0" onClick={() => remove(p)}>
              移除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
