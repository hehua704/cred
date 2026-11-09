import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, useInput, useStdout } from 'ink';
import { Screen } from './Screen.js';
import { createT } from '../i18n.js';
import { verify } from '../verify.js';
import { writeConfig } from '../config.js';
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
      const res = await verify(row.key, row.tok);
      patchRow(row.file, { status: res });
      store.setMeta(row.file, { lastStatus: res, lastCheckedAt: new Date().toISOString() });
      const text =
        res.ok === true ? t('status.valid') : res.ok === false ? t('status.invalid') : t('status.formatOk');
      setMessage(t('msg.checked', { name: row.label, text }));
    },
    [patchRow, store, t],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const row of store.rows()) {
        if (cancelled || !row.tok) continue;
        const res = await verify(row.key, row.tok);
        if (cancelled) return;
        patchRow(row.file, { status: res });
        store.setMeta(row.file, { lastStatus: res, lastCheckedAt: new Date().toISOString() });
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
      const row = rows[sel];
      const prev = store.readMeta()[im.file] ?? {};
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
        lastStatus: null,
      };
      if (!prev.expiresAt && row?.defaultExpiryDays) {
        patch.expiresAt = new Date(Date.now() + row.defaultExpiryDays * 86400000)
          .toISOString()
          .slice(0, 10);
      }
      store.setMeta(im.file, patch as never);
      const meta = store.readMeta()[im.file] ?? {};
      patchRow(im.file, {
        tok,
        updated: new Date(),
        status: null,
        mode: '600',
        expiresAt: meta.expiresAt ?? null,
      });
      setInput(null);
      setMessage(t('msg.saved', { name: im.label, n: tok.length }));
    },
    [patchRow, rows, sel, store, t],
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
          buffer: row.expiresAt ?? '',
          stage: 'input',
          replacing: false,
        });
        return;
      }
      if (inputStr === 'd') {
        if (!row?.tok) return;
        store.setMeta(row.file, { expiresAt: null, lastStatus: null });
        patchRow(row.file, { expiresAt: null, status: null });
        setMessage(t('msg.metaCleared', { name: row.label }));
        return;
      }
      if (inputStr === 'l') {
        setLangIndex(Math.max(0, LOCALES.indexOf(locale)));
        setMode('lang');
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

  const handleInput = useCallback(
    (inputStr: string, key: any) => {
      if (!input) return;
      if (input.kind === 'expiry') {
        if (key.escape) {
          setInput(null);
          return;
        }
        if (key.return) {
          const row = rows[sel];
          let val = input.buffer.trim();
          if (/^\+\d+d$/.test(val)) {
            val = new Date(Date.now() + Number(val.slice(1, -1)) * 86400000)
              .toISOString()
              .slice(0, 10);
          }
          store.setMeta(input.file, { expiresAt: val || null });
          patchRow(input.file, { expiresAt: val || null });
          setInput(null);
          setMessage(t('msg.expirySet', { name: row.label, value: val || '—' }));
          return;
        }
        if (key.backspace || key.delete) {
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
  };

  return <Screen state={state} t={t} />;
}
