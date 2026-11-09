import type { PlatformKey, Status } from './types.js';

const UA = { 'user-agent': 'cred/0.1.0' };

interface ProbeResult {
  status: number | 'ERR';
  body: any;
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
    return { status: res.status, body };
  } catch {
    return { status: 'ERR', body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function github(tok: string): Promise<Status> {
  const r = await probe('https://api.github.com/user', { authorization: `Bearer ${tok}` });
  if (r.status === 200) return { ok: true, user: r.body?.login ?? null, code: null };
  if (r.status === 401) return { ok: false, user: null, code: '401' };
  return { ok: null, user: null, code: String(r.status) };
}

async function crates(tok: string): Promise<Status> {
  // crates.io 已把 /api/v1/me 限制为仅网页可用：
  //   合法 token -> "this action can only be performed on the crates.io website"
  //   非法 token -> "authentication failed"
  const r = await probe('https://crates.io/api/v1/me', { authorization: tok });
  if (r.status === 200) return { ok: true, user: r.body?.user?.login ?? null, code: null };
  const detail: string = r.body?.errors?.[0]?.detail ?? '';
  if (detail.includes('website')) return { ok: true, user: null, code: null, note: 'website-only' };
  if (detail.includes('authentication')) return { ok: false, user: null, code: '403' };
  return { ok: null, user: null, code: String(r.status) };
}

async function npm(tok: string): Promise<Status> {
  const r = await probe('https://registry.npmjs.org/-/whoami', {
    authorization: `Bearer ${tok}`,
  });
  if (r.status === 200) return { ok: true, user: r.body?.username ?? null, code: null };
  if (r.status === 401) return { ok: false, user: null, code: '401' };
  return { ok: null, user: null, code: String(r.status) };
}

async function pypi(tok: string): Promise<Status> {
  // PyPI 没有 whoami 接口，只能做格式校验
  if (!tok.startsWith('pypi-')) return { ok: false, user: null, code: 'format' };
  if (tok.length < 80) return { ok: null, user: null, code: 'short' };
  return { ok: null, user: null, code: null, note: 'format-ok' };
}

const VALIDATORS: Record<PlatformKey, (tok: string) => Promise<Status>> = {
  github,
  crates,
  npm,
  pypi,
};

export async function verify(key: PlatformKey, token: string): Promise<Status> {
  const fn = VALIDATORS[key];
  if (!fn) return { ok: null, user: null, code: 'unsupported' };
  return fn(token);
}
