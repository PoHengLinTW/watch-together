export type PopupState = 'DISCONNECTED' | 'CONNECTED' | 'IN_ROOM';

export interface PopupStateData {
  state: PopupState;
  roomCode: string | null;
  peerCount: number;
  isConnecting: boolean;
}

export interface ButtonStates {
  joinDisabled: boolean;
  createDisabled: boolean;
  leaveDisabled: boolean;
}

export class PopupStateMachine {
  private data: PopupStateData = {
    state: 'DISCONNECTED',
    roomCode: null,
    peerCount: 0,
    isConnecting: false,
  };

  getState(): PopupStateData {
    return { ...this.data };
  }

  onConnecting(): void {
    this.data.isConnecting = true;
  }

  onConnected(): void {
    this.data.state = 'CONNECTED';
    this.data.isConnecting = false;
    this.data.roomCode = null;
    this.data.peerCount = 0;
  }

  onDisconnected(): void {
    this.data.state = 'DISCONNECTED';
    this.data.isConnecting = false;
    this.data.roomCode = null;
    this.data.peerCount = 0;
  }

  onRoomJoined(code: string): void {
    this.data.state = 'IN_ROOM';
    this.data.roomCode = code;
    this.data.peerCount = 1;
  }

  onRoomLeft(): void {
    this.data.state = 'CONNECTED';
    this.data.roomCode = null;
    this.data.peerCount = 0;
  }

  onPeerJoined(): void {
    this.data.peerCount++;
  }

  onPeerLeft(): void {
    this.data.peerCount = Math.max(0, this.data.peerCount - 1);
  }

  validateRoomCode(code: string): boolean {
    return /^[A-Za-z0-9]{6}$/.test(code);
  }

  getButtonStates(): ButtonStates {
    const { state, isConnecting } = this.data;
    return {
      joinDisabled: state !== 'CONNECTED' || isConnecting,
      createDisabled: state !== 'CONNECTED' || isConnecting,
      leaveDisabled: state !== 'IN_ROOM',
    };
  }
}
