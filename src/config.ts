import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface Config {
  locale?: string;
  fallback?: string;
  /** 本机代理，仅用于显式调用（cred proxy / cred run --proxy），不注入全局环境。 */
  proxy?: string;
}

export function parseToml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    let value: unknown = m[2].trim();
    const v = value as string;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      value = v.slice(1, -1);
    } else if (v === 'true' || v === 'false') {
      value = v === 'true';
    } else if (/^-?\d+$/.test(v)) {
      value = Number(v);
    }
    out[m[1]] = value;
  }
  return out;
}

export function readConfig(path: string): Config {
  if (!existsSync(path)) return {};
  try {
    return parseToml(readFileSync(path, 'utf8')) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(path: string, cfg: Config): boolean {
  const lines = [
    '# cred 配置 / configuration',
    '',
    `locale = "${cfg.locale ?? 'auto'}"          # zh-CN | en | auto`,
    `fallback = "${cfg.fallback ?? 'en'}"        # 缺失翻译时回退 / fallback locale`,
  ];
  if (cfg.proxy) lines.push(`proxy = "${cfg.proxy}"            # 仅 cred run --proxy / cred proxy 使用`);
  lines.push('');
  try {
    writeFileSync(path, lines.join('\n'), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
