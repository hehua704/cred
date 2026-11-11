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
import type { InputState, Mode, Row, ScreenState } from '../types.js';

export interface AppProps {
  store: Store;
  locale: string;
  configPath: string;
  config: Config;
  ascii: boolean;
}

const LOCALES = ['zh-CN', 'en', 'ja'];

// 有些终端把退格发成原始控制字符，key.backspace 不一定为真
function isBackspace(key: any, inputStr: string): boolean {
  return !!(key.backspace || key.delete) || inputStr === '\x7f' || inputStr === '\b';
}

export function App({ store, locale: initialLocale, configPath, config, ascii }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState<Row[]>(() => store.rows());
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [input, setInput] = useState<InputState | null>(null);
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

  const saveToken = useCallback(
    (im: InputState) => {
      const tok = im.buffer.trim();
      if (!store.saveToken(im.file, tok)) {
        setInput(null);
        setMessage(t('msg.writeFail', { code: 'EACCES' }));
        return;
      }
      const prev = store.readMeta()[im.file] ?? {};
      const now = new Date().toISOString();
      // 换了 token，旧的到期信息就不再属于这枚凭证：回到“未知”，等平台下一次告知。
      const patch = {
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
        lastStatus: null,
        expiresAt: null,
        expiresState: 'unknown' as const,
        expiresSource: null,
      };
      store.setMeta(im.file, patch);
      patchRow(im.file, {
        tok,
        updated: new Date(),
        status: null,
        mode: '600',
        expiresAt: null,
        expiresState: 'unknown',
        expiresSource: null,
      });
      setInput(null);
      setMessage(t('msg.saved', { name: im.label, n: tok.length }));
    },
    [patchRow, store, t],
  );

  const saveProxy = useCallback(
    (patch: Partial<Config>) => {
      Object.assign(config, patch);
      const ok = writeConfig(configPath, config);
      setMessage(ok ? t('proxy.saved') : t('msg.writeFail', { code: 'EACCES' }));
    },
    [config, configPath, t],
  );

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
        setInput({
          kind: 'token',
          file: row.file,
          label: row.label,
          buffer: '',
          stage: 'input',
          replacing: !!row.tok,
        });
        return;
      }
      if (inputStr === 'e') {
        if (!row?.tok) {
          setMessage(t('msg.noToken'));
          return;
        }
        setInput({
          kind: 'expiry',
          file: row.file,
          label: `${row.label} ${t('field.expires')}`,
          buffer: row.expiresState === 'never' ? 'none' : (row.expiresAt ?? ''),
          stage: 'input',
          replacing: false,
        });
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
    [copy, exit, locale, patchRow, rows, runVerify, sel, store, t],
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
        if (proxySel === 1) {
          setInput({
            kind: 'proxy-url',
            file: '',
            label: t('proxy.address'),
            buffer: proxyUrl,
            stage: 'input',
            replacing: false,
          });
          return;
        }
        setInput({
          kind: 'proxy-bypass',
          file: '',
          label: t('proxy.bypass'),
          buffer: proxyBypass,
          stage: 'input',
          replacing: false,
        });
      }
    },
    [proxyBypass, proxyEnabled, proxySel, proxyUrl, saveProxy, t],
  );

  const handleInput = useCallback(
    (inputStr: string, key: any) => {
      if (!input) return;
      if (input.kind === 'proxy-url' || input.kind === 'proxy-bypass') {
        if (key.escape) {
          setInput(null);
          return;
        }
        if (key.return) {
          const v = input.buffer.trim();
          if (input.kind === 'proxy-url') {
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
          setInput(null);
          return;
        }
        if (isBackspace(key, inputStr)) {
          setInput({ ...input, buffer: input.buffer.slice(0, -1) });
          return;
        }
        if (inputStr) setInput({ ...input, buffer: input.buffer + inputStr.replace(/[\r\n\t]/g, '') });
        return;
      }

      if (input.kind === 'expiry') {
        if (key.escape) {
          setInput(null);
          return;
        }
        if (key.return) {
          const row = rows[sel];
          const parsed = parseExpiryInput(input.buffer);
          if (!parsed) {
            setMessage(t('input.expiryInvalid'));
            return;
          }
          const patch = {
            expiresAt: parsed.state === 'date' ? parsed.at : null,
            expiresState: parsed.state,
            expiresSource: parsed.state === 'unknown' ? null : ('manual' as const),
          };
          store.setMeta(input.file, patch);
          patchRow(input.file, patch);
          setInput(null);
          setMessage(
            t('msg.expirySet', {
              name: row.label,
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
        if (isBackspace(key, inputStr)) {
          setInput({ ...input, buffer: input.buffer.slice(0, -1) });
          return;
        }
        if (inputStr) setInput({ ...input, buffer: input.buffer + inputStr.replace(/[\r\n\t]/g, '') });
        return;
      }

      if (input.stage === 'confirm') {
        if (key.return || inputStr === 'y') saveToken(input);
        else if (key.escape || inputStr === 'n') {
          setInput(null);
          setMessage(t('msg.cancelled'));
        }
        return;
      }
      if (key.escape) {
        setInput(null);
        setMessage(t('msg.cancelled'));
        return;
      }
      if (key.return) {
        if (!input.buffer.trim()) {
          setMessage(t('input.empty'));
          return;
        }
        if (input.replacing) setInput({ ...input, stage: 'confirm' });
        else saveToken(input);
        return;
      }
      if (key.backspace || key.delete) {
        setInput({ ...input, buffer: input.buffer.slice(0, -1) });
        return;
      }
      if (inputStr) {
        const clean = inputStr.replace(/[\r\n\t]/g, '');
        if (clean) setInput({ ...input, buffer: input.buffer + clean });
      }
    },
    [input, patchRow, rows, saveToken, sel, store, t],
  );

  useInput((inputStr, key) => {
    if (input) return handleInput(inputStr, key);
    if (mode === 'lang') return handleLang(inputStr, key);
    if (mode === 'proxy') return handleProxy(inputStr, key);
    return handleList(inputStr, key);
  });

  const state: ScreenState = {
    rows,
    sel,
    mode,
    input,
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
