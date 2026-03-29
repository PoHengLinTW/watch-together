export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info(message, meta) {
    console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  },
  warn(message, meta) {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  },
  error(message, meta) {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  },
};
