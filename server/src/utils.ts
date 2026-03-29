import { randomInt } from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Generate a random 6-character uppercase alphanumeric room code. */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARSET[randomInt(0, CHARSET.length)];
  }
  return code;
}
