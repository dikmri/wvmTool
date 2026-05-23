const isDev = import.meta.env.DEV;

type LogData = Record<string, unknown> | Error | unknown;

export const logger = {
  info(tag: string, data?: LogData) {
    if (isDev) console.log(`[INFO] ${tag}`, data ?? '');
  },
  debug(tag: string, data?: LogData) {
    if (isDev) console.debug(`[DEBUG] ${tag}`, data ?? '');
  },
  warn(tag: string, data?: LogData) {
    console.warn(`[WARN] ${tag}`, data ?? '');
  },
  error(tag: string, data?: LogData) {
    console.error(`[ERROR] ${tag}`, data ?? '');
  },
};
