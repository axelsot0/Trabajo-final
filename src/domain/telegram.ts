import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type TelegramLinkKind = 'card' | 'notification' | 'list';

export interface TelegramMessageLink {
  telegramChatId: number;
  telegramMessageId: number;
  employeeId: Id;
  conversationId: Id;
  kind: TelegramLinkKind;
  createdAtUtc: IsoUtc;
}

/** Acciones que un botón inline puede disparar. Las de gestión llegan en fases posteriores. */
export type CallbackAction =
  'view' | 'chats_page' | 'mychats_page' | 'claim' | 'close' | 'transfer' | 'outcome';

export interface CallbackToken {
  token: string;
  employeeId: Id;
  conversationId: Id | null;
  action: CallbackAction;
  params: string | null;
  singleUse: boolean;
  expiresAtUtc: IsoUtc;
  usedAtUtc: IsoUtc | null;
  createdAtUtc: IsoUtc;
}

/** 16 bytes aleatorios en base64url: 22 caracteres, muy por debajo del límite de 64 bytes. */
export function newCallbackToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
