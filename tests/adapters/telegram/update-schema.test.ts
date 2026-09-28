import { describe, expect, it } from 'vitest';

import {
  telegramUpdateSchema,
  toMinimalUpdate,
} from '../../../src/adapters/telegram/update-schema.ts';
import { callbackUpdate, textUpdate } from '../../support/telegram-updates.ts';

describe('telegramUpdateSchema + toMinimalUpdate', () => {
  it('reduce un mensaje con Reply a su forma mínima', () => {
    const raw = textUpdate({ fromId: 42, text: 'Hola', replyToMessageId: 7 });
    const minimal = toMinimalUpdate(telegramUpdateSchema.parse(raw));
    expect(minimal.callback).toBeNull();
    expect(minimal.message).toMatchObject({
      fromId: 42,
      chatId: 42,
      chatType: 'private',
      text: 'Hola',
      replyToMessageId: 7,
      isBot: false,
    });
  });

  it('reduce un callback y tolera campos extra', () => {
    const raw = callbackUpdate({ fromId: 42, messageId: 9, data: 'tok' });
    const minimal = toMinimalUpdate(telegramUpdateSchema.parse({ ...raw, extra: { x: 1 } }));
    expect(minimal.message).toBeNull();
    expect(minimal.callback).toEqual({
      id: expect.any(String) as string,
      fromId: 42,
      chatId: 42,
      messageId: 9,
      data: 'tok',
    });
  });

  it('rechaza updates sin update_id', () => {
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false);
  });
});
