import { currentLanguage } from '../../shared/i18n';

export function formatMemory(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  const value = mib >= 1024 ? mib / 1024 : mib;
  const unit = mib >= 1024 ? 'GB' : 'MB';
  return `${new Intl.NumberFormat(currentLanguage(), { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${unit}`;
}

export function relativeTime(time: number, now = Date.now()): string {
  const seconds = Math.round((time - now) / 1000);
  const format = new Intl.RelativeTimeFormat(currentLanguage(), { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return format.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

export function elapsedTime(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
