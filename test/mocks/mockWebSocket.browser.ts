import { vi } from 'vitest';

export class MockBrowserWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockBrowserWebSocket.CONNECTING;
  send = vi.fn();
  close = vi.fn();
  url: string;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  simulateOpen(): void {
    this.readyState = MockBrowserWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  simulateMessage(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockBrowserWebSocket.CLOSED;
    this.onclose?.({ code, reason } as unknown as CloseEvent);
  }

  simulateError(): void {
    this.readyState = MockBrowserWebSocket.CLOSED;
    this.onerror?.({} as Event);
  }
}

/** Returns a factory function that creates and tracks MockBrowserWebSocket instances */
export function createWsFactory(): {
  factory: (url: string) => MockBrowserWebSocket;
  instances: MockBrowserWebSocket[];
} {
  const instances: MockBrowserWebSocket[] = [];
  const factory = (url: string): MockBrowserWebSocket => {
    const ws = new MockBrowserWebSocket(url);
    instances.push(ws);
    return ws;
  };
  return { factory, instances };
}
