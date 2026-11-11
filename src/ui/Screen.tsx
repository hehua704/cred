import React from 'react';
import { Box, Text } from 'ink';
import type { Row, ScreenState } from '../types.js';
import type { TFn } from '../i18n.js';
import { width as textWidth, truncate } from '../width.js';

export interface Theme {
  border: 'round' | 'classic';
  valid: string;
  invalid: string;
  formatOk: string;
  unset: string;
  unknown: string;
  pointer: string;
  dot: string;
  markOn: string;
  markOff: string;
  dash: string;
  blank: string;
}

export function theme(ascii: boolean): Theme {
  return ascii
    ? { border: 'classic', valid: '*', invalid: 'x', formatOk: '~', unset: '.', unknown: '?', pointer: '>', dot: '.', markOn: '*', markOff: 'o', dash: '-', blank: '-' }
    : { border: 'round', valid: '●', invalid: '✕', formatOk: '◐', unset: '○', unknown: '?', pointer: '▸', dot: '•', markOn: '●', markOff: '○', dash: '─', blank: '—' };
}

const LEFT_W = 30;
const BODY_H = 9;
const LABEL_W = 12;

export function mask(tok: string | null, th: Theme): string {
  if (!tok) return th.blank;
  if (tok.length <= 12) return tok.slice(0, 3) + th.dot.repeat(4);
  return tok.slice(0, 6) + th.dot.repeat(8) + tok.slice(-4);
}

export function ago(date: Date | null, t: TFn): string {
  if (!date) return '—';
  const sec = (Date.now() - date.getTime()) / 1000;
  if (sec < 60) return t('time.justNow');
  if (sec < 3600) return t('time.minutesAgo', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('time.hoursAgo', { n: Math.floor(sec / 3600) });
  return t('time.daysAgo', { n: Math.floor(sec / 86400) });
}

/**
 * 只有两种状态可以显示成确定结论：
 *   - 平台/用户给了日期  -> “N 天后 / 已过期”
 *   - 明确说了不过期      -> “不过期”
 * 其余一律“未知”，不再把缺失当成“不过期”。
 */
export function expiryText(
  row: Pick<Row, 'expiresAt' | 'expiresState'>,
  t: TFn,
): string {
  if (row.expiresState === 'never') return t('time.none');
  if (row.expiresState !== 'date' || !row.expiresAt) return t('time.unknown');
  const d = new Date(row.expiresAt);
  if (Number.isNaN(d.getTime())) return t('time.unknown');
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return t('time.expired', { n: -days });
  if (days === 0) return t('time.today');
  return t('time.daysLeft', { n: days });
}

export interface StatusView {
  icon: string;
  color: string;
  text: string;
  short: string;
  user: string | null;
}

export function statusView(row: Row, t: TFn, th: Theme): StatusView {
  if (!row.tok) {
    return { icon: th.unset, color: 'gray', text: t('status.unset'), short: t('status.unset'), user: null };
  }
  const s = row.status;
  if (!s) {
    return { icon: th.unknown, color: 'gray', text: t('status.unknown'), short: t('status.unknown'), user: null };
  }
  if (s.ok === true) {
    return {
      icon: th.valid,
      color: 'green',
      text: s.user ? `${t('status.valid')} · ${s.user}` : t('status.valid'),
      short: t('status.valid'),
      user: s.user,
    };
  }
  if (s.ok === null && s.code === 'need-user') {
    return { icon: th.formatOk, color: 'yellow', text: t('status.needUser'), short: t('status.needUser'), user: null };
  }
  if (s.ok === false) {
    const suffix = s.code && s.code !== 'format' ? ` · ${s.code}` : '';
    return { icon: th.invalid, color: 'red', text: `${t('status.invalid')}${suffix}`, short: t('status.invalid'), user: null };
  }
  return { icon: th.formatOk, color: 'yellow', text: t('status.formatOk'), short: t('status.formatOk'), user: null };
}

function Sep({ th, top }: { th: Theme; top?: boolean }) {
  return (
    <Box
      borderStyle={th.border}
      borderColor="gray"
      borderTop={!!top}
      borderBottom={!top}
      borderLeft={false}
      borderRight={false}
      height={1}
    />
  );
}

function RowLine({ row, active, t, th }: { row: Row; active: boolean; t: TFn; th: Theme }) {
  const st = statusView(row, t, th);
  return (
    <Box>
      <Box width={2}>
        <Text color={active ? 'blue' : undefined}>{active ? th.pointer : ' '}</Text>
      </Box>
      <Box width={LABEL_W}>
        <Text bold={active} wrap="truncate">
          {row.label}
        </Text>
      </Box>
      <Box width={2}>
        <Text color={st.color}>{st.icon}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={st.color} wrap="truncate">
          {st.short}
        </Text>
      </Box>
    </Box>
  );
}

function Detail({ row, t, th, paneWidth }: { row: Row | undefined; t: TFn; th: Theme; paneWidth: number }) {
  if (!row) return <Box />;
  const st = statusView(row, t, th);
  const field = (label: string, value: string, color?: string) => (
    <Box>
      <Box width={LABEL_W}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={color} wrap="truncate">
          {value}
        </Text>
      </Box>
    </Box>
  );
  return (
    <Box flexDirection="column">
      <Text bold>{row.label}</Text>
      <Text dimColor>{th.dash.repeat(Math.max(10, paneWidth - 2))}</Text>
      {field(t('field.credential'), mask(row.tok, th))}
      {field(t('field.user'), st.user ?? th.blank)}
      {field(t('field.status'), `${st.icon} ${st.text}`, st.color)}
      {field(t('field.updated'), ago(row.updated, t))}
      {field(
        t('field.expires'),
        row.expiresSource === 'manual' && row.expiresState !== 'unknown'
          ? `${expiryText(row, t)} · ${t('time.manual')}`
          : expiryText(row, t),
      )}
      <Text> </Text>
      <Text dimColor>{[t('hint.copy'), t('hint.reveal'), t('hint.verify')].join('  ')}</Text>
    </Box>
  );
}

export function LangScreen({ state, t, th }: { state: ScreenState; t: TFn; th: Theme }) {
  const entries = [
    { code: 'zh-CN', label: '中文 (zh-CN)', supported: true },
    { code: 'en', label: 'English (en)', supported: true },
    { code: 'ja', label: '日本語 (ja)', supported: false },
  ];
  return (
    <Box flexDirection="column" width={Math.min(state.columns, 110)}>
      <Box borderStyle={th.border} borderColor="gray" flexDirection="column">
        <Box paddingX={1}>
          <Text bold>{t('lang.title')}</Text>
        </Box>
        <Sep th={th} />
        <Box paddingX={1} flexDirection="column" height={5}>
          <Text> </Text>
          {entries.map((e, i) => (
            <Box key={e.code}>
              <Box width={2}>
                <Text color={i === state.langIndex ? 'blue' : undefined}>
                  {i === state.langIndex ? th.pointer : ' '}
                </Text>
              </Box>
              <Box width={2}>
                <Text>{e.code === state.locale ? th.markOn : th.markOff}</Text>
              </Box>
              <Text bold={i === state.langIndex}>{e.label}</Text>
              {!e.supported ? <Text dimColor>{`   ${t('lang.unsupported')}`}</Text> : null}
            </Box>
          ))}
        </Box>
        <Box paddingX={1} flexDirection="column">
          <Text dimColor wrap="truncate">
            {`${t('lang.current')}: ${state.configPath} (locale = "${state.configLocale}")`}
          </Text>
          <Text dimColor wrap="truncate">
            {t('lang.priority')}
          </Text>
        </Box>
        <Sep th={th} top />
        <Box paddingX={1}>
          <Text dimColor>
            {[t('hint.select'), state.ascii ? 'Enter' : 'Enter ✓', t('hint.back')].join('   ')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function ProxyScreen({ state, t, th }: { state: ScreenState; t: TFn; th: Theme }) {
  const p = state.proxy;
  const W = Math.min(state.columns, 110);
  const maxVal = Math.max(12, W - 20);
  const rows = [
    { key: 'enabled', label: t('proxy.enabled'), value: p.enabled ? t('proxy.on') : t('proxy.off') },
    { key: 'url', label: t('proxy.address'), value: p.url || t('proxy.none') },
    { key: 'bypass', label: t('proxy.bypass'), value: p.bypass },
  ];
  return (
    <Box flexDirection="column" width={W}>
      <Box borderStyle={th.border} borderColor="gray" flexDirection="column">
        <Box paddingX={1}>
          <Text bold>{t('proxy.title')}</Text>
        </Box>
        <Sep th={th} />
        <Box paddingX={1} flexDirection="column" height={5}>
          <Text> </Text>
          {rows.map((r, i) => (
            <Box key={r.key}>
              <Box width={2}>
                <Text color={i === p.sel ? 'blue' : undefined}>{i === p.sel ? th.pointer : ' '}</Text>
              </Box>
              <Box width={10}>
                <Text bold={i === p.sel}>{r.label}</Text>
              </Box>
              <Text wrap="truncate">{truncate(r.value, maxVal)}</Text>
            </Box>
          ))}
        </Box>
        <Box paddingX={1} flexDirection="column">
          {state.input ? (
            <Box>
              <Text color="yellow">{`${state.input.label} `}</Text>
              <Text>{truncate(state.input.buffer, maxVal)}</Text>
            </Box>
          ) : (
            <Text dimColor wrap="truncate">{`${t('proxy.config')}: ${state.configPath}`}</Text>
          )}
        </Box>
        <Sep th={th} top />
        <Box paddingX={1}>
          <Text dimColor wrap="truncate">
            {state.input
              ? state.input.kind === 'proxy-url'
                ? t('input.proxyUrlHint')
                : t('input.proxyBypassHint')
              : [t('hint.select'), t('proxy.enterHint'), t('hint.back')].join('   ')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// 英文文案比中文长：先试双空格，放不下退单空格
function fitHints(parts: string[], maxWidth: number): string {
  const two = parts.join('  ') + ' ';
  if (textWidth(two) <= maxWidth) return two;
  const one = parts.join(' ') + ' ';
  if (textWidth(one) <= maxWidth) return one;
  return one.slice(0, Math.max(0, maxWidth - 1)) + '…';
}

export function Screen({ state, t }: { state: ScreenState; t: TFn }) {
  const th = theme(state.ascii);
  const W = Math.max(60, Math.min(state.columns, 110));

  if (state.mode === 'lang') return <LangScreen state={state} t={t} th={th} />;
  if (state.mode === 'proxy') return <ProxyScreen state={state} t={t} th={th} />;

  const langName = state.locale === 'zh-CN' ? '中文' : state.locale === 'en' ? 'EN' : state.locale.toUpperCase();
  const twoPane = W >= 76;

  return (
    <Box flexDirection="column" width={W}>
      <Box borderStyle={th.border} borderColor="gray" flexDirection="column">
        <Box paddingX={1} justifyContent="space-between">
          <Text bold>{`${t('app.brand')} · ${t('app.title')}`}</Text>
          <Text dimColor>{`${t('app.langLabel')}: ${langName}  ${state.dir} `}</Text>
        </Box>
        <Sep th={th} />

        <Box height={BODY_H}>
          <Box width={twoPane ? LEFT_W : W - 2} flexDirection="column" paddingX={1}>
            <Text dimColor>{t('nav.credentials')}</Text>
            {state.rows.map((row, i) => (
              <RowLine key={row.key} row={row} active={i === state.sel} t={t} th={th} />
            ))}
          </Box>
          {twoPane ? (
            <>
              <Box
                borderStyle={th.border}
                borderColor="gray"
                borderLeft
                borderTop={false}
                borderBottom={false}
                borderRight={false}
              />
              <Box flexGrow={1} flexDirection="column" paddingX={1}>
                <Detail row={state.rows[state.sel]} t={t} th={th} paneWidth={Math.max(20, W - LEFT_W - 4)} />
              </Box>
            </>
          ) : null}
        </Box>

        <Sep th={th} top />

        {state.input ? (
          <Box flexDirection="column" paddingX={1}>
            <Box>
              <Text color="yellow">{`${state.input.label} `}</Text>
              <Text>
                {state.input.kind === 'token'
                  ? state.input.stage === 'confirm'
                    ? ' '
                    : th.dot.repeat(Math.min(state.input.buffer.length, 40))
                  : state.input.buffer}
              </Text>
            </Box>
            <Text dimColor wrap="truncate">
              {state.input.stage === 'confirm' ? t('input.confirmHint') : t('input.expiryHint')}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            <Text dimColor wrap="truncate">
              {fitHints(
                [
                  t('hint.select'),
                  t('hint.copy'),
                  t('hint.reveal'),
                  t('hint.verify'),
                  t('hint.expiry'),
                  t('hint.proxy'),
                  t('hint.add'),
                  t('hint.delete'),
                  t('hint.lang'),
                  t('hint.quit'),
                ],
                W - 4,
              )}
            </Text>
            <Text color="green" wrap="truncate">
              {state.message || ' '}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
