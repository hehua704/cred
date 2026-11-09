import { readFileSync } from 'node:fs';

export const SUPPORTED = ['zh-CN', 'en'] as const;

export const AVAILABLE = [
  { code: 'zh-CN', label: '中文 (zh-CN)' },
  { code: 'en', label: 'English (en)' },
  { code: 'ja', label: '日本語 (ja)' },
] as const;

export type Dict = Record<string, string>;
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

const LOCALES_URL = new URL('../locales/', import.meta.url);
const cache = new Map<string, Dict>();

export function loadDict(locale: string): Dict {
  if (cache.has(locale)) return cache.get(locale)!;
  let dict: Dict = {};
  if ((SUPPORTED as readonly string[]).includes(locale)) {
    try {
      dict = JSON.parse(readFileSync(new URL(`${locale}.json`, LOCALES_URL), 'utf8')) as Dict;
    } catch {
      dict = {};
    }
  }
  cache.set(locale, dict);
  return dict;
}

export function normalizeLocale(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim().replace(/\.(UTF-8|utf8)$/i, '');
  if (!raw) return null;
  const parts = raw.split(/[_.@-]/);
  const lang = (parts[0] || '').toLowerCase();
  const region = (parts[1] || '').toUpperCase();
  if (lang === 'zh') return 'zh-CN';
  if (lang === 'en') return 'en';
  if (lang === 'ja') return 'ja';
  return null;
}

export function resolveLocale(input: {
  flag?: string | null;
  env?: string | null;
  config?: { locale?: string } | null;
  sys?: string | null;
}): string {
  const { flag, env, config, sys } = input;
  const candidates = [
    flag,
    env,
    config?.locale && config.locale !== 'auto' ? config.locale : null,
    sys,
    'zh-CN',
  ];
  for (const c of candidates) {
    const n = normalizeLocale(c);
    if (n) return n;
  }
  return 'zh-CN';
}

export function createT(locale: string, fallback = 'en'): TFn {
  const dict = loadDict(locale);
  const fb = loadDict(fallback);
  const base = Object.keys(dict).length ? dict : fb;
  return (key, vars) => {
    let raw = base[key];
    if (raw === undefined) raw = fb[key];
    if (raw === undefined) raw = key;
    if (!vars) return raw;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      vars[k] === undefined ? '' : String(vars[k]),
    );
  };
}
