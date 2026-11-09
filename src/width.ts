export function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff);
  return wide ? 2 : 1;
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function width(s: string): number {
  let n = 0;
  for (const ch of stripAnsi(s)) n += charWidth(ch);
  return n;
}

export function pad(s: string, target: number): string {
  const d = target - width(s);
  return d > 0 ? s + ' '.repeat(d) : s;
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (width(s) <= max) return s;
  let out = '';
  let acc = 0;
  for (const ch of s) {
    const w = charWidth(ch);
    if (acc + w > max - 1) break;
    out += ch;
    acc += w;
  }
  return out + '…';
}
