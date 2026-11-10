import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMS } from './platforms.js';
import type { Expiry, ExpirySource, ExpiryState, Row, Status } from './types.js';

export interface MetaEntry {
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  /** date = 平台/用户给了准确日期；never = 明确不过期；unknown = 没有依据 */
  expiresState?: ExpiryState;
  expiresSource?: ExpirySource | null;
  lastStatus?: Status | null;
  lastCheckedAt?: string;
}

export type Meta = Record<string, MetaEntry>;

/** 老版本只存了 expiresAt：有日期当 date（来源按手动），没日期就是未知。 */
export function resolveExpiry(m: MetaEntry): {
  at: string | null;
  state: ExpiryState;
  source: ExpirySource | null;
} {
  const at = m.expiresAt ?? null;
  return {
    at,
    state: m.expiresState ?? (at ? 'date' : 'unknown'),
    source: m.expiresSource ?? (at ? 'manual' : null),
  };
}

/**
 * 把一次校验拿到的到期信息合并进 meta：
 *   - 平台给了结论（日期 / 不过期）-> 以平台为准；
 *   - 平台没说，但用户手动填过        -> 保留手动值；
 *   - 平台没说且没有手动值            -> 未知；
 *   - 这次压根没拿到响应（expiry = null）-> 什么都不改，避免网络抖动抹掉已有信息。
 */
export function expiryPatch(prev: MetaEntry, expiry: Expiry | null): Partial<MetaEntry> {
  if (!expiry) return {};
  if (expiry.state !== 'unknown') {
    return { expiresAt: expiry.at, expiresState: expiry.state, expiresSource: 'platform' };
  }
  if (prev.expiresSource === 'manual') return {};
  return { expiresAt: null, expiresState: 'unknown', expiresSource: null };
}

export interface Store {
  dir: string;
  metaPath: string;
  readMeta(): Meta;
  writeMeta(meta: Meta): boolean;
  readToken(file: string): string | null;
  saveToken(file: string, token: string): boolean;
  setMeta(file: string, patch: MetaEntry): boolean;
  rows(): Row[];
}

export function createStore(dir: string): Store {
  const metaPath = join(dir, 'meta.json');

  function readMeta(): Meta {
    if (!existsSync(metaPath)) return {};
    try {
      return JSON.parse(readFileSync(metaPath, 'utf8')) as Meta;
    } catch {
      return {};
    }
  }

  function writeMeta(meta: Meta): boolean {
    try {
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  function readToken(file: string): string | null {
    const p = join(dir, file);
    if (!existsSync(p)) return null;
    try {
      const raw = readFileSync(p, 'utf8').trim();
      if (!raw) return null;
      return raw.split(/\s+/)[0];
    } catch {
      return null;
    }
  }

  function saveToken(file: string, token: string): boolean {
    try {
      writeFileSync(join(dir, file), token + '\n', { mode: 0o600 });
      try {
        chmodSync(join(dir, file), 0o600);
      } catch {
        /* ignore */
      }
      return true;
    } catch {
      return false;
    }
  }

  function setMeta(file: string, patch: MetaEntry): boolean {
    const meta = readMeta();
    meta[file] = { ...(meta[file] ?? {}), ...patch };
    return writeMeta(meta);
  }

  function rows(): Row[] {
    const meta = readMeta();
    return PLATFORMS.map((p) => {
      const tok = readToken(p.file);
      let mode: string | null = null;
      let updated: Date | null = null;
      const full = join(dir, p.file);
      if (existsSync(full)) {
        try {
          const st = statSync(full);
          mode = (st.mode & 0o777).toString(8);
          updated = st.mtime;
        } catch {
          /* ignore */
        }
      }
      const m = meta[p.file] ?? {};
      const exp = resolveExpiry(m);
      return {
        ...p,
        tok,
        mode,
        updated,
        expiresAt: exp.at,
        expiresState: exp.state,
        expiresSource: exp.source,
        status: m.lastStatus ?? null,
      };
    });
  }

  return { dir, metaPath, readMeta, writeMeta, readToken, saveToken, setMeta, rows };
}
