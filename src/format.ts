import { CommitInfo } from './git';

export type DateFormat = 'relative' | 'absolute';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const diff = unixSeconds - now / 1000;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return 'just now';
}

export function absoluteDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(unixSeconds: number, fmt: DateFormat): string {
  return fmt === 'relative' ? relativeTime(unixSeconds) : absoluteDate(unixSeconds);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Text shown at the end of the current line. */
export function inlineText(c: CommitInfo, fmt: DateFormat): string {
  if (c.uncommitted) {
    return 'You • Not committed yet';
  }
  return `${c.author}, ${formatDate(c.authorTime, fmt)} • ${truncate(c.summary, 60)}`;
}

/** Fixed-width text shown before every line in file-blame mode. */
export function gutterText(c: CommitInfo): string {
  if (c.uncommitted) {
    return 'Not committed yet'.padEnd(GUTTER_WIDTH);
  }
  const author = truncate(c.author, 14).padEnd(14);
  return `${shortSha(c.sha)} ${author} ${absoluteDate(c.authorTime)}`;
}

export const GUTTER_WIDTH = 7 + 1 + 14 + 1 + 10;
