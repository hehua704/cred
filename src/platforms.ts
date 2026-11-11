import type { Platform, PlatformKey } from './types.js';

export const PLATFORMS: Platform[] = [
  { key: 'github', file: 'github-token', label: 'GitHub PAT' },
  { key: 'crates', file: 'crates-token', label: 'crates.io' },
  { key: 'pypi', file: 'pypi-token', label: 'PyPI' },
  { key: 'npm', file: 'npm-token', label: 'npm' },
  { key: 'docker', file: 'docker-token', label: 'Docker Hub' },
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
