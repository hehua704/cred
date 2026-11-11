import type { Expiry, PlatformKey, Status } from './types.js';

const UA = { 'user-agent': 'cred/0.1.2' };

export interface VerifyResult {
  status: Status;
  /** null = 这次没拿到有效响应，调用方应保留旧值；unknown = 平台没说。 */
  expiry: Expiry | null;
}

interface ProbeResult {
  status: number | 'ERR';
  body: any;
  headers: Record<string, string>;
}

async function probe(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* 非 JSON */
    }
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return { status: res.status, body, headers: out };
  } catch {
    return { status: 'ERR', body: null, headers: {} };
  } finally {
    clearTimeout(timer);
  }
}

const UNKNOWN: Expiry = { state: 'unknown', at: null };
const NO_RESPONSE = null;

/**
 * GitHub 对「会过期的 token」会在响应头里带 github-authentication-token-expiration，
 * 形如 `2027-02-08 12:00:00 UTC`。头不存在时**不推断**「不过期」——
 * 平台没说就是未知，宁可显示未知也不编一个日期。
 */
export function parseGithubExpiry(headers: Record<string, string>): Expiry {
  const raw = headers['github-authentication-token-expiration'];
  if (!raw) return UNKNOWN;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (!m) return UNKNOWN;
  const d = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  return { state: 'date', at: m[1] };
}

async function github(tok: string): Promise<VerifyResult> {
  const r = await probe('https://api.github.com/user', { authorization: `Bearer ${tok}` });
  const expiry = r.status === 'ERR' ? NO_RESPONSE : parseGithubExpiry(r.headers);
  if (r.status === 200) {
    return { status: { ok: true, user: r.body?.login ?? null, code: null }, expiry };
  }
  if (r.status === 401) return { status: { ok: false, user: null, code: '401' }, expiry };
  return { status: { ok: null, user: null, code: String(r.status) }, expiry };
}

async function crates(tok: string): Promise<VerifyResult> {
  // crates.io 已把 /api/v1/me 限制为仅网页可用：
  //   合法 token -> "this action can only be performed on the crates.io website"
  //   非法 token -> "authentication failed"
  // 接口不返回任何到期字段，所以到期永远是未知。
  const r = await probe('https://crates.io/api/v1/me', { authorization: tok });
  const expiry = r.status === 'ERR' ? NO_RESPONSE : UNKNOWN;
  if (r.status === 200) {
    return { status: { ok: true, user: r.body?.user?.login ?? null, code: null }, expiry };
  }
  const detail: string = r.body?.errors?.[0]?.detail ?? '';
  if (detail.includes('website')) {
    return { status: { ok: true, user: null, code: null, note: 'website-only' }, expiry };
  }
  if (detail.includes('authentication')) {
    return { status: { ok: false, user: null, code: '403' }, expiry };
  }
  return { status: { ok: null, user: null, code: String(r.status) }, expiry };
}

async function npm(tok: string): Promise<VerifyResult> {
  // /-/whoami 只回用户名，token 的到期时间不对外暴露。
  const r = await probe('https://registry.npmjs.org/-/whoami', {
    authorization: `Bearer ${tok}`,
  });
  const expiry = r.status === 'ERR' ? NO_RESPONSE : UNKNOWN;
  if (r.status === 200) {
    return { status: { ok: true, user: r.body?.username ?? null, code: null }, expiry };
  }
  if (r.status === 401) return { status: { ok: false, user: null, code: '401' }, expiry };
  return { status: { ok: null, user: null, code: String(r.status) }, expiry };
}

async function docker(tok: string): Promise<VerifyResult> {
  // Docker Hub 的 PAT（dckr_pat_…）可以用 Bearer 调 /v2/user/，返回用户名。
  // 到期时间不对外暴露，所以永远是未知。
  const r = await probe('https://hub.docker.com/v2/user/', {
    authorization: `Bearer ${tok}`,
  });
  const expiry = r.status === 'ERR' ? NO_RESPONSE : UNKNOWN;
  if (r.status === 200) {
    return { status: { ok: true, user: r.body?.username ?? null, code: null }, expiry };
  }
  if (r.status === 401) return { status: { ok: false, user: null, code: '401' }, expiry };
  return { status: { ok: null, user: null, code: String(r.status) }, expiry };
}

async function pypi(tok: string): Promise<VerifyResult> {
  // PyPI 没有 whoami 接口，只能做格式校验；到期信息也没有。
  if (!tok.startsWith('pypi-')) {
    return { status: { ok: false, user: null, code: 'format' }, expiry: UNKNOWN };
  }
  if (tok.length < 80) return { status: { ok: null, user: null, code: 'short' }, expiry: UNKNOWN };
  return { status: { ok: null, user: null, code: null, note: 'format-ok' }, expiry: UNKNOWN };
}

const VALIDATORS: Record<PlatformKey, (tok: string) => Promise<VerifyResult>> = {
  github,
  crates,
  npm,
  pypi,
  docker,
};

export async function verify(key: PlatformKey, token: string): Promise<VerifyResult> {
  const fn = VALIDATORS[key];
  if (!fn) return { status: { ok: null, user: null, code: 'unsupported' }, expiry: UNKNOWN };
  return fn(token);
}
