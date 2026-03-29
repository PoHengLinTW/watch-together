import { describe, it, expect, beforeEach } from 'vitest';
import { PopupStateMachine } from '../../src/popup/PopupStateMachine.js';

describe('PopupStateMachine', () => {
  let machine: PopupStateMachine;

  beforeEach(() => {
    machine = new PopupStateMachine();
  });

  it('should start in DISCONNECTED state', () => {
    expect(machine.getState().state).toBe('DISCONNECTED');
  });

  it('should transition to CONNECTED after successful connect', () => {
    machine.onConnected();
    expect(machine.getState().state).toBe('CONNECTED');
  });

  it('should transition to IN_ROOM after create or join', () => {
    machine.onConnected();
    machine.onRoomJoined('ABC123');
    expect(machine.getState().state).toBe('IN_ROOM');
  });

  it('should transition back to CONNECTED on leave', () => {
    machine.onConnected();
    machine.onRoomJoined('ABC123');
    machine.onRoomLeft();
    expect(machine.getState().state).toBe('CONNECTED');
  });

  it('should transition to DISCONNECTED on connection loss', () => {
    machine.onConnected();
    machine.onRoomJoined('ABC123');
    machine.onDisconnected();
    expect(machine.getState().state).toBe('DISCONNECTED');
  });

  it('should show room code in IN_ROOM state', () => {
    machine.onConnected();
    machine.onRoomJoined('XYZ789');
    expect(machine.getState().roomCode).toBe('XYZ789');
  });

  it('should show peer count in IN_ROOM state', () => {
    machine.onConnected();
    machine.onRoomJoined('ABC123');
    expect(machine.getState().peerCount).toBe(1);

    machine.onPeerJoined();
    expect(machine.getState().peerCount).toBe(2);

    machine.onPeerLeft();
    expect(machine.getState().peerCount).toBe(1);
  });

  it('should disable join button while connecting', () => {
    machine.onConnecting();
    expect(machine.getState().isConnecting).toBe(true);
    expect(machine.getButtonStates().joinDisabled).toBe(true);
  });

  it('should validate room code format before sending join', () => {
    // Valid: 6 alphanumeric chars
    expect(machine.validateRoomCode('ABC123')).toBe(true);
    expect(machine.validateRoomCode('abc123')).toBe(true);
    expect(machine.validateRoomCode('000000')).toBe(true);

    // Invalid
    expect(machine.validateRoomCode('AB12')).toBe(false);     // too short
    expect(machine.validateRoomCode('ABC12!')).toBe(false);   // special char
    expect(machine.validateRoomCode('')).toBe(false);          // empty
    expect(machine.validateRoomCode('ABCDEFG')).toBe(false);  // too long
  });
});
