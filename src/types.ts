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

/** 到期来源：平台告知、用户手填、或新增时按 90 天填的默认值。 */
export type ExpiryState = 'date' | 'never' | 'unknown';
export type ExpirySource = 'platform' | 'manual' | 'default';

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

export type FieldKey = 'token' | 'user' | 'expiry';

export interface FormField {
  key: FieldKey;
  label: string;
  value: string;
  /** 打开表单时的初始值，用来判断用户是否改过（决定到期来源是 manual 还是 default） */
  initial: string;
  masked: boolean;
  required: boolean;
}

export interface FormState {
  kind: 'token' | 'expiry' | 'proxy-url' | 'proxy-bypass';
  file: string;
  title: string;
  fields: FormField[];
  sel: number;
  stage: 'edit' | 'confirm';
  replacing: boolean;
}

export interface ScreenState {
  rows: Row[];
  sel: number;
  mode: Mode;
  form: FormState | null;
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
