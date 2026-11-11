export type PlatformKey = 'github' | 'crates' | 'pypi' | 'npm' | 'docker';

export interface Platform {
  key: PlatformKey;
  file: string;
  label: string;
}

export interface Status {
  ok: boolean | null;
  user: string | null;
  code: string | null;
  note?: string;
}

/** 到期信息只认两个来源：平台自己说的（platform），或用户手动填的（manual）。 */
export type ExpiryState = 'date' | 'never' | 'unknown';
export type ExpirySource = 'platform' | 'manual';

export interface Expiry {
  state: ExpiryState;
  at: string | null;
}

export interface Row extends Platform {
  tok: string | null;
  mode: string | null;
  updated: Date | null;
  expiresAt: string | null;
  expiresState: ExpiryState;
  expiresSource: ExpirySource | null;
  username: string | null;
  status: Status | null;
}

export type Mode = 'list' | 'lang' | 'proxy';

export interface ProxyState {
  enabled: boolean;
  url: string;
  bypass: string;
  sel: number;
}

export interface InputState {
  kind: 'token' | 'expiry' | 'proxy-url' | 'proxy-bypass';
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
  proxy: ProxyState;
}
