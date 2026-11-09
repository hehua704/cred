import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMS } from './platforms.js';
import type { Row, Status } from './types.js';

export interface MetaEntry {
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  lastStatus?: Status | null;
  lastCheckedAt?: string;
}

export type Meta = Record<string, MetaEntry>;

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
      return {
        ...p,
        tok,
        mode,
        updated,
        expiresAt: m.expiresAt ?? null,
        status: m.lastStatus ?? null,
      };
    });
  }

  return { dir, metaPath, readMeta, writeMeta, readToken, saveToken, setMeta, rows };
}
