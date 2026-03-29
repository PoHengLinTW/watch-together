import { PopupStateMachine } from './PopupStateMachine';
import type { PopupMessage, BackgroundToPopupMessage } from '../shared/messages';

const machine = new PopupStateMachine();
let peerCount = 0;

// DOM elements
const statusEl = document.getElementById('status')!;
const roomDisplayEl = document.getElementById('room-display')!;
const roomCodeDisplayEl = document.getElementById('room-code-display')!;
const peerCountEl = document.getElementById('peer-count')!;
const joinSectionEl = document.getElementById('join-section')!;
const roomCodeInputEl = document.getElementById('room-code-input') as HTMLInputElement;
const createRoomBtn = document.getElementById('create-room-btn') as HTMLButtonElement;
const joinRoomBtn = document.getElementById('join-room-btn') as HTMLButtonElement;
const leaveRoomBtn = document.getElementById('leave-room-btn') as HTMLButtonElement;
const errorMsgEl = document.getElementById('error-msg')!;

function render(): void {
  const data = machine.getState();
  const buttons = machine.getButtonStates();

  // Status text
  statusEl.className = 'status';
  if (data.state === 'DISCONNECTED') {
    if (data.isReconnecting) {
      statusEl.textContent = 'Reconnecting...';
      statusEl.classList.add('reconnecting');
    } else {
      statusEl.textContent = data.isConnecting ? 'Connecting...' : 'Disconnected';
      statusEl.classList.add('disconnected');
    }
  } else if (data.state === 'CONNECTED') {
    statusEl.textContent = 'Connected';
    statusEl.classList.add('connected');
  } else {
    statusEl.textContent = 'In room';
    statusEl.classList.add('in-room');
  }

  // Room display
  if (data.state === 'IN_ROOM' && data.roomCode) {
    roomDisplayEl.classList.remove('hidden');
    roomCodeDisplayEl.textContent = data.roomCode;
    peerCountEl.textContent = String(peerCount);
    joinSectionEl.classList.add('hidden');
  } else {
    roomDisplayEl.classList.add('hidden');
    joinSectionEl.classList.remove('hidden');
  }

  // Buttons
  createRoomBtn.disabled = buttons.createDisabled;
  joinRoomBtn.disabled = buttons.joinDisabled;
  leaveRoomBtn.disabled = buttons.leaveDisabled;
}

function showError(message: string): void {
  errorMsgEl.textContent = message;
  errorMsgEl.classList.remove('hidden');
  setTimeout(() => errorMsgEl.classList.add('hidden'), 3000);
}

function sendToBackground(msg: PopupMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Button handlers
createRoomBtn.addEventListener('click', () => {
  machine.onConnecting();
  render();
  sendToBackground({ type: 'create-room' });
});

joinRoomBtn.addEventListener('click', () => {
  const code = roomCodeInputEl.value.trim().toUpperCase();
  if (!machine.validateRoomCode(code)) {
    showError('Enter a valid 6-character room code');
    return;
  }
  machine.onConnecting();
  render();
  sendToBackground({ type: 'join-room', code });
});

leaveRoomBtn.addEventListener('click', () => {
  sendToBackground({ type: 'leave-room' });
  machine.onRoomLeft();
  peerCount = 0;
  render();
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as BackgroundToPopupMessage;

  if (msg.type === 'state-update') {
    if (msg.state === 'CONNECTED') {
      machine.onConnected();
      peerCount = 0;
    } else if (msg.state === 'DISCONNECTED') {
      machine.onDisconnected();
      peerCount = 0;
    } else if (msg.state === 'RECONNECTING') {
      machine.onReconnecting();
      peerCount = 0;
    } else if (msg.state === 'IN_ROOM') {
      machine.onRoomJoined(msg.roomCode ?? '');
      peerCount = msg.peerCount;
    }
  } else if (msg.type === 'peer-joined') {
    machine.onPeerJoined();
    peerCount++;
  } else if (msg.type === 'peer-left') {
    machine.onPeerLeft();
    peerCount = Math.max(0, peerCount - 1);
  } else if (msg.type === 'error') {
    showError(msg.message);
    // Reset connecting state
    machine.onConnected();
  }

  render();
});

// Initial state request
machine.onConnecting();
render();
sendToBackground({ type: 'get-state' });
