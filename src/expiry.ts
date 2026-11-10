import type { ExpiryState } from './types.js';

export interface ParsedExpiry {
  state: ExpiryState;
  at: string | null;
}

/**
 * 解析用户在 `e` 里输入的有效期：
 *   YYYY-MM-DD  -> 准确日期
 *   +90d        -> 今天 + 90 天
 *   none/never  -> 明确不过期
 *   空/unknown  -> 未知（清除）
 * 其它          -> null（格式不对，调用方提示后保留输入）
 */
export function parseExpiryInput(raw: string, now = Date.now()): ParsedExpiry | null {
  const v = raw.trim();
  if (!v || /^(unknown|未知|\?)$/i.test(v)) return { state: 'unknown', at: null };
  if (/^(none|never|不过期)$/i.test(v)) return { state: 'never', at: null };
  if (/^\+\d+d$/.test(v)) {
    const days = Number(v.slice(1, -1));
    const d = new Date(now + days * 86400000);
    return { state: 'date', at: d.toISOString().slice(0, 10) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    // 挡掉 2027-02-31 这种会被 Date 顺延的日期
    if (d.toISOString().slice(0, 10) !== v) return null;
    return { state: 'date', at: v };
  }
  return null;
}
