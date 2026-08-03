import type { Logger } from '../types.ts';

type Level = 'debug' | 'info' | 'warn' | 'error';

export function createLogger(scope: string, minLevel: Level = 'info'): Logger {
  const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const threshold = order[minLevel];

  const write = (level: Level, message: string, meta?: Record<string, unknown>) => {
    if (order[level] < threshold) return;
    const line = meta && Object.keys(meta).length > 0
      ? `${message} ${JSON.stringify(meta)}`
      : message;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level.toUpperCase()}] [${scope}] ${line}`);
  };

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, e) => {
      const meta = e instanceof Error ? { error: e.message } : e === undefined ? undefined : { error: String(e) };
      write('error', m, meta);
      if (e instanceof Error && e.stack && order.error >= threshold) {
        console.error(`[ERROR] [${scope}] ${e.stack}`);
      }
    },
  };
}
