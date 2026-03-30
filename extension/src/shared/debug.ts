import type { DebugLogMessage } from './messages';

export interface DebugLogger {
  log(event: string, payload?: unknown): void;
}

const PREFIX = '[WatchTogether]';

export function createConsoleDebugLogger(scope: DebugLogMessage['scope']): DebugLogger {
  return {
    log(event: string, payload?: unknown): void {
      if (payload === undefined) {
        console.debug(PREFIX, scope, event);
        return;
      }
      console.debug(PREFIX, scope, event, payload);
    },
  };
}
