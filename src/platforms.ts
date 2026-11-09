import type { Platform, PlatformKey } from './types.js';

export const PLATFORMS: Platform[] = [
  { key: 'github', file: 'github-token', label: 'GitHub PAT', defaultExpiryDays: 90 },
  { key: 'crates', file: 'crates-token', label: 'crates.io', defaultExpiryDays: null },
  { key: 'pypi', file: 'pypi-token', label: 'PyPI', defaultExpiryDays: null },
  { key: 'npm', file: 'npm-token', label: 'npm', defaultExpiryDays: null },
];

export const PLATFORM_KEYS: PlatformKey[] = PLATFORMS.map((p) => p.key);

export function findPlatform(arg: string | null | undefined): Platform | null {
  if (!arg) return null;
  const a = String(arg).toLowerCase();
  return (
    PLATFORMS.find(
      (p) =>
        p.key === a ||
        p.file === arg ||
        p.file === `${a}-token` ||
        p.label.toLowerCase() === a ||
        p.label.toLowerCase().includes(a),
    ) ?? null
  );
}
