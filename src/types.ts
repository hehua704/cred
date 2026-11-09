export type PlatformKey = 'github' | 'crates' | 'pypi' | 'npm';

export interface Platform {
  key: PlatformKey;
  file: string;
  label: string;
  defaultExpiryDays: number | null;
}

export interface Status {
  ok: boolean | null;
  user: string | null;
  code: string | null;
  note?: string;
}

export interface Row extends Platform {
  tok: string | null;
  mode: string | null;
  updated: Date | null;
  expiresAt: string | null;
  status: Status | null;
}

export type Mode = 'list' | 'lang';

export interface InputState {
  kind: 'token' | 'expiry';
  file: string;
  label: string;
  buffer: string;
  stage: 'input' | 'confirm';
  replacing: boolean;
}

export interface ScreenState {
  rows: Row[];
  sel: number;
  mode: Mode;
  input: InputState | null;
  message: string;
  revealed: boolean;
  locale: string;
  langIndex: number;
  dir: string;
  columns: number;
  configPath: string;
  configLocale: string;
  ascii: boolean;
}
