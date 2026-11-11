import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, useInput, useStdout } from 'ink';
import { Screen } from './Screen.js';
import { createT } from '../i18n.js';
import { verify } from '../verify.js';
import { writeConfig, DEFAULT_BYPASS } from '../config.js';
import { expiryPatch } from '../store.js';
import { parseExpiryInput } from '../expiry.js';
import type { Config } from '../config.js';
import type { Store } from '../store.js';
import type { FieldKey, FormField, FormState, Mode, Row, ScreenState } from '../types.js';

export interface AppProps {
  store: Store;
  locale: string;
  configPath: string;
  config: Config;
  ascii: boolean;
}

const LOCALES = ['zh-CN', 'en', 'ja'];
const DEFAULT_EXPIRY = '+90d';

// 有些终端把退格发成原始控制字符，key.backspace 不一定为真
function isBackspace(key: any, inputStr: string): boolean {
  return !!(key.backspace || key.delete) || inputStr === '\x7f' || inputStr === '\b';
}

function fieldOf(f: FormState, key: FieldKey) {
  return f.fields.find((x) => x.key === key);
}

function withValue(f: FormState, key: FieldKey, value: string): FormState {
  return { ...f, fields: f.fields.map((x) => (x.key === key ? { ...x, value } : x)) };
}

export function App({ store, locale: initialLocale, configPath, config, ascii }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState<Row[]>(() => store.rows());
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [locale, setLocale] = useState(initialLocale);
  const [langIndex, setLangIndex] = useState(Math.max(0, LOCALES.indexOf(initialLocale)));
  const [proxyEnabled, setProxyEnabled] = useState(config.proxy_enabled === true);
  const [proxyUrl, setProxyUrl] = useState(config.proxy ?? '');
  const [proxyBypass, setProxyBypass] = useState(config.proxy_bypass || DEFAULT_BYPASS);
  const [proxySel, setProxySel] = useState(0);
  const termColumns = () => (stdout as unknown as { columns?: number })?.columns ?? 80;
  const [columns, setColumns] = useState(termColumns());

  const t = useMemo(() => createT(locale, config.fallback ?? 'en'), [locale, config.fallback]);

  useEffect(() => {
    const onResize = () => setColumns(termColumns());
    stdout?.on('resize', onResize);
    return () => {
      stdout?.off('resize', onResize);
    };
  }, [stdout]);

  const patchRow = useCallback((file: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.file === file ? { ...r, ...patch } : r)));
  }, []);

  const runVerify = useCallback(
    async (row: Row) => {
      if (!row.tok) {
        setMessage(t('msg.noToken'));
        return;
      }
      setMessage(t('msg.checking', { name: row.label }));
      const prev = store.readMeta()[row.file] ?? {};
      const { status, expiry } = await verify(row.key, row.tok, { username: prev.username });
      const patch = expiryPatch(prev, expiry);
      patchRow(row.file, { status, ...patch });
      store.setMeta(row.file, { lastStatus: status, lastCheckedAt: new Date().toISOString(), ...patch });
      const text =
        status.ok === true ? t('status.valid') : status.ok === false ? t('status.invalid') : t('status.formatOk');
      setMessage(t('msg.checked', { name: row.label, text }));
    },
    [patchRow, store, t],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const row of store.rows()) {
        if (cancelled || !row.tok) continue;
        const meta = store.readMeta()[row.file] ?? {};
        const { status, expiry } = await verify(row.key, row.tok, { username: meta.username });
        if (cancelled) return;
        const patch = expiryPatch(meta, expiry);
        patchRow(row.file, { status, ...patch });
        store.setMeta(row.file, { lastStatus: status, lastCheckedAt: new Date().toISOString(), ...patch });
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = useCallback((text: string) => {
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    process.stdout.write(
      process.env.TMUX ? `\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\` : `\x1b]52;c;${b64}\x07`,
    );
  }, []);

  const saveProxy = useCallback(
    (patch: Partial<Config>) => {
      Object.assign(config, patch);
      const ok = writeConfig(configPath, config);
      setMessage(ok ? t('proxy.saved') : t('msg.writeFail', { code: 'EACCES' }));
    },
    [config, configPath, t],
  );

  // ---------- 表单 ----------

  const openTokenForm = useCallback(
    (row: Row) => {
      const prev = store.readMeta()[row.file] ?? {};
      const exp = row.expiresAt ?? DEFAULT_EXPIRY;
      const fields: FormField[] = [
        {
          key: 'token' as const,
          label: t('form.token'),
          value: '',
          initial: '',
          masked: true,
          required: true,
        },
      ];
      if (row.key === 'docker') {
        fields.push({
          key: 'user' as const,
          label: t('form.user'),
          value: prev.username ?? '',
          initial: prev.username ?? '',
          masked: false,
          required: true,
        });
      }
      fields.push({
        key: 'expiry' as const,
        label: t('form.expiry'),
        value: exp,
        initial: exp,
        masked: false,
        required: false,
      });
      setForm({
        kind: 'token',
        file: row.file,
        title: t('form.tokenTitle', { name: row.label }),
        fields,
        sel: 0,
        stage: 'edit',
        replacing: !!row.tok,
      });
    },
    [store, t],
  );

  const openExpiryForm = useCallback(
    (row: Row) => {
      const value = row.expiresState === 'never' ? 'none' : (row.expiresAt ?? DEFAULT_EXPIRY);
      setForm({
        kind: 'expiry',
        file: row.file,
        title: t('form.expiryTitle', { name: row.label }),
        fields: [
          {
            key: 'expiry',
            label: t('form.expiry'),
            value,
            initial: value,
            masked: false,
            required: false,
          },
        ],
        sel: 0,
        stage: 'edit',
        replacing: false,
      });
    },
    [t],
  );

  const openProxyForm = useCallback(
    (kind: 'proxy-url' | 'proxy-bypass') => {
      const isUrl = kind === 'proxy-url';
      const value = isUrl ? proxyUrl : proxyBypass;
      setForm({
        kind,
        file: '',
        title: isUrl ? t('proxy.address') : t('proxy.bypass'),
        fields: [
          {
            key: 'user',
            label: isUrl ? t('proxy.address') : t('proxy.bypass'),
            value,
            initial: value,
            masked: false,
            required: false,
          },
        ],
        sel: 0,
        stage: 'edit',
        replacing: false,
      });
    },
    [proxyBypass, proxyUrl, t],
  );

  const submitForm = useCallback(
    (f: FormState) => {
      const close = () => setForm(null);

      if (f.kind === 'proxy-url' || f.kind === 'proxy-bypass') {
        const v = f.fields[0].value.trim();
        if (f.kind === 'proxy-url') {
          if (v && !/^https?:\/\/\S+$/.test(v)) {
            setMessage(t('proxy.invalid'));
            return;
          }
          setProxyUrl(v);
          saveProxy({ proxy: v || undefined });
        } else {
          const next = v || DEFAULT_BYPASS;
          setProxyBypass(next);
          saveProxy({ proxy_bypass: next });
        }
        close();
        return;
      }

      if (f.kind === 'expiry') {
        const parsed = parseExpiryInput(f.fields[0].value);
        if (!parsed) {
          setMessage(t('input.expiryInvalid'));
          return;
        }
        const patch = {
          expiresAt: parsed.state === 'date' ? parsed.at : null,
          expiresState: parsed.state,
          expiresSource: parsed.state === 'unknown' ? null : ('manual' as const),
        };
        store.setMeta(f.file, patch);
        patchRow(f.file, patch);
        close();
        setMessage(
          t('msg.expirySet', {
            name: rows[sel]?.label ?? f.file,
            value:
              parsed.state === 'date'
                ? String(parsed.at)
                : parsed.state === 'never'
                  ? t('time.none')
                  : t('time.unknown'),
          }),
        );
        return;
      }

      // token
      const tok = fieldOf(f, 'token')?.value.trim() ?? '';
      const userField = fieldOf(f, 'user');
      const user = userField?.value.trim() ?? '';
      const expField = fieldOf(f, 'expiry');
      const parsed = parseExpiryInput(expField?.value.trim() || DEFAULT_EXPIRY);
      if (!tok) {
        setMessage(t('input.empty'));
        return;
      }
      if (userField?.required && !user) {
        setMessage(t('form.userRequired'));
        return;
      }
      if (!parsed) {
        setMessage(t('input.expiryInvalid'));
        return;
      }
      if (!store.saveToken(f.file, tok)) {
        close();
        setMessage(t('msg.writeFail', { code: 'EACCES' }));
        return;
      }

      const prev = store.readMeta()[f.file] ?? {};
      const now = new Date().toISOString();
      const source = expField && expField.value !== expField.initial ? 'manual' : 'default';
      const patch = {
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
        lastStatus: null,
        expiresAt: parsed.state === 'date' ? parsed.at : null,
        expiresState: parsed.state,
        expiresSource: parsed.state === 'unknown' ? null : source,
        ...(user ? { username: user } : {}),
      };
      store.setMeta(f.file, patch as never);
      patchRow(f.file, {
        tok,
        updated: new Date(),
        status: null,
        mode: '600',
        expiresAt: patch.expiresAt,
        expiresState: patch.expiresState,
        expiresSource: patch.expiresSource as never,
        ...(user ? { username: user } : {}),
      });
      close();
      setMessage(t('msg.saved', { name: rows[sel]?.label ?? f.file, n: tok.length }));
    },
    [patchRow, rows, saveProxy, sel, store, t],
  );

  const handleForm = useCallback(
    (inputStr: string, key: any) => {
      if (!form) return;
      const f = form;

      if (f.stage === 'confirm') {
        if (key.return || inputStr === 'y') submitForm(f);
        else if (key.escape || inputStr === 'n') {
          setForm({ ...f, stage: 'edit' });
          setMessage(t('msg.cancelled'));
        }
        return;
      }

      if (key.escape) {
        setForm(null);
        setMessage(t('msg.cancelled'));
        return;
      }

      const n = f.fields.length;
      if (key.upArrow || (key.shift && key.tab)) {
        setForm({ ...f, sel: (f.sel - 1 + n) % n });
        return;
      }
      if (key.downArrow || key.tab) {
        setForm({ ...f, sel: (f.sel + 1) % n });
        return;
      }

      if (key.return) {
        const missing = f.fields.find((x) => x.required && !x.value.trim());
        if (missing) {
          setMessage(t('input.empty'));
          return;
        }
        if (f.kind === 'token' && f.replacing) {
          setForm({ ...f, stage: 'confirm' });
          return;
        }
        submitForm(f);
        return;
      }

      const cur = f.fields[f.sel];
      if (isBackspace(key, inputStr)) {
        setForm(withValue(f, cur.key, cur.value.slice(0, -1)));
        return;
      }
      if (inputStr) {
        const clean = inputStr.replace(/[\r\n\t]/g, '');
        if (clean) setForm(withValue(f, cur.key, cur.value + clean));
      }
    },
    [form, submitForm, t],
  );

  // ---------- 列表 ----------

  const handleList = useCallback(
    (inputStr: string, key: any) => {
      const row = rows[sel];
      if (inputStr === 'q' || (key.ctrl && inputStr === 'c')) {
        exit();
        return;
      }
      if (key.upArrow || inputStr === 'k') {
        setSel((s) => (s - 1 + rows.length) % rows.length);
        setMessage('');
        return;
      }
      if (key.downArrow || inputStr === 'j') {
        setSel((s) => (s + 1) % rows.length);
        setMessage('');
        return;
      }
      if (inputStr === 'v') {
        setRevealed((v) => !v);
        return;
      }
      if (inputStr === 'c') {
        if (!row?.tok) {
          setMessage(t('msg.noToken'));
          return;
        }
        copy(row.tok);
        setMessage(`${t('msg.copied', { name: row.label })} — ${t('msg.copiedFallback')}`);
        return;
      }
      if (inputStr === 'r') {
        void runVerify(row);
        return;
      }
      if (inputStr === 'a') {
        openTokenForm(row);
        return;
      }
      if (inputStr === 'e') {
        if (!row?.tok) {
          setMessage(t('msg.noToken'));
          return;
        }
        openExpiryForm(row);
        return;
      }
      if (inputStr === 'd') {
        if (!row?.tok) return;
        store.setMeta(row.file, {
          expiresAt: null,
          expiresState: 'unknown',
          expiresSource: null,
          lastStatus: null,
        });
        patchRow(row.file, {
          expiresAt: null,
          expiresState: 'unknown',
          expiresSource: null,
          status: null,
        });
        setMessage(t('msg.metaCleared', { name: row.label }));
        return;
      }
      if (inputStr === 'l') {
        setLangIndex(Math.max(0, LOCALES.indexOf(locale)));
        setMode('lang');
        return;
      }
      if (inputStr === 'p') {
        setProxySel(0);
        setMessage('');
        setMode('proxy');
      }
    },
    [copy, exit, locale, openExpiryForm, openTokenForm, patchRow, rows, runVerify, sel, store, t],
  );

  const handleLang = useCallback(
    (inputStr: string, key: any) => {
      if (key.escape) {
        setMode('list');
        return;
      }
      if (key.upArrow || inputStr === 'k') {
        setLangIndex((i) => (i - 1 + LOCALES.length) % LOCALES.length);
        return;
      }
      if (key.downArrow || inputStr === 'j') {
        setLangIndex((i) => (i + 1) % LOCALES.length);
        return;
      }
      if (key.return) {
        const code = LOCALES[langIndex];
        const ok = writeConfig(configPath, { ...config, locale: code });
        config.locale = code;
        setLocale(code);
        setMode('list');
        setMessage(ok ? t('lang.saved', { locale: code }) : t('msg.writeFail', { code: 'EACCES' }));
      }
    },
    [config, configPath, langIndex, t],
  );

  const handleProxy = useCallback(
    (inputStr: string, key: any) => {
      if (key.escape) {
        setMode('list');
        return;
      }
      if (key.upArrow || inputStr === 'k') {
        setProxySel((i) => (i + 2) % 3);
        return;
      }
      if (key.downArrow || inputStr === 'j') {
        setProxySel((i) => (i + 1) % 3);
        return;
      }
      if (key.return || inputStr === ' ') {
        if (proxySel === 0) {
          const next = !proxyEnabled;
          setProxyEnabled(next);
          saveProxy({ proxy_enabled: next });
          return;
        }
        openProxyForm(proxySel === 1 ? 'proxy-url' : 'proxy-bypass');
      }
    },
    [openProxyForm, proxyEnabled, proxySel, saveProxy],
  );

  useInput((inputStr, key) => {
    if (form) return handleForm(inputStr, key);
    if (mode === 'lang') return handleLang(inputStr, key);
    if (mode === 'proxy') return handleProxy(inputStr, key);
    return handleList(inputStr, key);
  });

  const state: ScreenState = {
    rows,
    sel,
    mode,
    form,
    message,
    revealed,
    locale,
    langIndex,
    dir: store.dir,
    columns,
    configPath,
    configLocale: config.locale ?? 'auto',
    ascii,
    proxy: { enabled: proxyEnabled, url: proxyUrl, bypass: proxyBypass, sel: proxySel },
  };

  return <Screen state={state} t={t} />;
}
