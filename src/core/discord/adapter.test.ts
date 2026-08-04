import { describe, expect, test } from 'bun:test';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { createFakeButtonInteraction, createFakeInteraction } from '../testing.ts';
import { createLogger } from '../internal/logger.ts';
import {
  dispatchInteraction,
  resolveGrantedCapabilities,
  resolvePreconditionEnv,
  resultToPayload,
  sendResult,
  toApiEmbed,
  toInput,
  type InteractionHandler,
} from './adapter.ts';

type Fake = ReturnType<typeof createFakeInteraction>;
type FakeButton = ReturnType<typeof createFakeButtonInteraction>;

function asChat(fake: Fake): ChatInputCommandInteraction {
  return fake as unknown as ChatInputCommandInteraction;
}

function asButton(fake: FakeButton): ButtonInteraction {
  return fake as unknown as ButtonInteraction;
}

const logger = createLogger('test', 'error');

describe('toInput', () => {
  test('переносит имя, аргументы, автора и канал', () => {
    const fake = createFakeInteraction({ commandName: 'roll', args: { dice: '3d6' } });
    expect(toInput(asChat(fake))).toEqual({
      commandName: 'roll',
      args: { dice: '3d6' },
      author: { id: 'user1', username: 'User' },
      channel: { id: 'channel1', guildId: 'guild1' },
    });
  });

  test('ДМ: без guildId', () => {
    const fake = createFakeInteraction({ dm: true, commandName: 'help' });
    expect(toInput(asChat(fake)).channel).toEqual({ id: 'channel1' });
  });
});

describe('resolvePreconditionEnv', () => {
  test('права участника и NSFW', () => {
    const fake = createFakeInteraction({ memberPermissions: ['Administrator'], isNsfw: true });
    const env = resolvePreconditionEnv(asChat(fake), ['owner1']);
    expect(env.memberPermissions?.has('Administrator')).toBe(true);
    expect(env.isNsfw).toBe(true);
    expect(env.owners).toEqual(['owner1']);
  });

  test('в ДМ прав и NSFW нет', () => {
    const fake = createFakeInteraction({ dm: true });
    const env = resolvePreconditionEnv(asChat(fake), []);
    expect(env.memberPermissions?.size ?? 0).toBe(0);
    expect(env.isNsfw).toBe(false);
  });
});

describe('resolveGrantedCapabilities', () => {
  test('права бота в канале', () => {
    const fake = createFakeInteraction({ botPermissions: ['EmbedLinks', 'SendMessages'] });
    const granted = resolveGrantedCapabilities(asChat(fake));
    expect(granted.has('EmbedLinks')).toBe(true);
    expect(granted.has('SendMessages')).toBe(true);
    expect(granted.has('AttachFiles')).toBe(false);
  });

  test('в ДМ всё выдано', () => {
    const fake = createFakeInteraction({ dm: true });
    const granted = resolveGrantedCapabilities(asChat(fake));
    expect(granted.has('SendMessages')).toBe(true);
    expect(granted.has('EmbedLinks')).toBe(true);
    expect(granted.has('AttachFiles')).toBe(true);
  });
});

describe('resultToPayload', () => {
  test('message', () => {
    expect(resultToPayload({ kind: 'message', content: 'hi' })).toEqual({ content: 'hi' });
  });

  test('embed нормализуется через EmbedBuilder', () => {
    const payload = resultToPayload({
      kind: 'embed',
      embed: { title: 'Заголовок', description: 'Описание', color: 0xff0000 },
    });
    const embed = payload.embeds?.[0] as { title?: string; color?: number } | undefined;
    expect(embed?.title).toBe('Заголовок');
    expect(embed?.color).toBe(0xff0000);
  });

  test('attachment: Buffer из Uint8Array', () => {
    const payload = resultToPayload({
      kind: 'attachment',
      file: { name: 'f.txt', data: new TextEncoder().encode('abc') },
      caption: 'файл',
    });
    const file = payload.files?.[0] as { name?: string; attachment?: unknown } | undefined;
    expect(payload.content).toBe('файл');
    expect(file?.name).toBe('f.txt');
    expect(file?.attachment).toBeInstanceOf(Buffer);
  });

  test('multiple: склейка', () => {
    const payload = resultToPayload({
      kind: 'multiple',
      results: [
        { kind: 'message', content: 'a' },
        { kind: 'message', content: 'b' },
      ],
    });
    expect(payload.content).toBe('a\nb');
  });

  test('component: кнопки с customId, стилем и эмодзи', () => {
    const payload = resultToPayload({
      kind: 'component',
      content: 'выбор',
      rows: [
        {
          buttons: [
            { id: 'roll:reroll', label: '🎲 Ещё', style: 'primary' },
            { id: 'roll:page:2', label: '2' },
            { id: 'site', label: 'Сайт', style: 'link', url: 'https://x.example' },
          ],
        },
      ],
    });
    expect(payload.content).toBe('выбор');
    const row = payload.components?.[0] as { components: unknown[] } | undefined;
    expect(row?.components.length).toBe(3);
  });

  test('component без content — только кнопки', () => {
    const payload = resultToPayload({ kind: 'component', rows: [{ buttons: [{ id: 'a', label: 'A' }] }] });
    expect(payload.content).toBeUndefined();
    expect(payload.components?.length).toBe(1);
  });

  test('update недопустим внутри payload → бросает', () => {
    expect(() =>
      resultToPayload({ kind: 'update', result: { kind: 'message', content: 'x' } }),
    ).toThrow('sendResult');
  });
});

describe('toApiEmbed', () => {
  test('timestamp остаётся строкой ISO', () => {
    const api = toApiEmbed({ title: 't', timestamp: '2020-01-01T00:00:00.000Z' });
    expect(api.timestamp).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('sendResult', () => {
  test('реплаит payload', async () => {
    const fake = createFakeInteraction();
    await sendResult(asChat(fake), { kind: 'message', content: 'Понг!' });
    expect(fake.replies).toEqual([{ content: 'Понг!' }]);
  });

  test('если уже ответили — followUp', async () => {
    const fake = createFakeInteraction();
    fake.replied = true;
    await sendResult(asChat(fake), { kind: 'message', content: 'дальше' });
    expect(fake.replies).toEqual([]);
    expect(fake.followUps).toEqual([{ content: 'дальше' }]);
  });

  test('update на кнопке — interaction.update (без ephemeral)', async () => {
    const fake = createFakeButtonInteraction({ customId: 'roll:reroll' });
    await sendResult(asButton(fake), {
      kind: 'update',
      result: { kind: 'message', content: 'новый результат', ephemeral: true },
    });
    expect(fake.updates).toEqual([{ content: 'новый результат' }]);
    expect(fake.replies).toEqual([]);
  });

  test('update с component-Result сохраняет кнопки и срезает ephemeral', async () => {
    const fake = createFakeButtonInteraction({ customId: 'list:page' });
    await sendResult(asButton(fake), {
      kind: 'update',
      result: { kind: 'component', rows: [{ buttons: [{ id: 'list:page:2', label: '2' }] }], ephemeral: true },
    });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({ components: expect.anything() });
  });

  test('если reply упал — fallback на followUp', async () => {
    const fake = createFakeInteraction();
    fake.reply = async () => { throw new Error('discord timeout'); };
    await sendResult(asChat(fake), { kind: 'message', content: 'всё равно доставлю' });
    expect(fake.replies).toEqual([]);
    expect(fake.followUps).toEqual([{ content: 'всё равно доставлю' }]);
  });

  test('update из slash-команды деградирует до reply', async () => {
    const fake = createFakeInteraction();
    await sendResult(asChat(fake), {
      kind: 'update',
      result: { kind: 'message', content: 'просто ответ' },
    });
    expect(fake.replies).toEqual([{ content: 'просто ответ' }]);
  });
});

describe('dispatchInteraction', () => {
  test('прогоняет фейковое взаимодействие через handler и доставляет', async () => {
    const fake = createFakeInteraction({ commandName: 'ping' });
    const handler: InteractionHandler = {
      handle: async (input) => ({ kind: 'message', content: `ok:${input.commandName}` }),
      handleComponent: async () => undefined,
    };
    await dispatchInteraction(asChat(fake), { handler, owners: [], logger });
    expect(fake.replies).toEqual([{ content: 'ok:ping' }]);
  });

  test('не-chat-input и не-кнопка игнорируется', async () => {
    const fake = { isChatInputCommand: () => false, isButton: () => false };
    const handler: InteractionHandler = {
      handle: async () => ({ kind: 'message', content: 'x' }),
      handleComponent: async () => undefined,
    };
    await dispatchInteraction(fake as unknown as ChatInputCommandInteraction, { handler, owners: [], logger });
    expect((fake as { isChatInputCommand: () => boolean }).isChatInputCommand()).toBe(false);
  });

  test('undefined от handler — без ответа', async () => {
    const fake = createFakeInteraction({ commandName: 'unknown' });
    const handler: InteractionHandler = {
      handle: async () => undefined,
      handleComponent: async () => undefined,
    };
    await dispatchInteraction(asChat(fake), { handler, owners: [], logger });
    expect(fake.replies).toEqual([]);
  });

  test('кнопка: роутит клик в handleComponent и доставляет', async () => {
    const fake = createFakeButtonInteraction({ customId: 'roll:reroll' });
    const handler: InteractionHandler = {
      handle: async () => undefined,
      handleComponent: async (click) => ({ kind: 'message', content: `click:${click.customId}` }),
    };
    await dispatchInteraction(asButton(fake), { handler, owners: [], logger });
    expect(fake.replies).toEqual([{ content: 'click:roll:reroll' }]);
  });

  test('кнопка: update-Result перезаписывает сообщение', async () => {
    const fake = createFakeButtonInteraction({ customId: 'roll:reroll' });
    const handler: InteractionHandler = {
      handle: async () => undefined,
      handleComponent: async () => ({ kind: 'update', result: { kind: 'message', content: 'бросок обновлён' } }),
    };
    await dispatchInteraction(asButton(fake), { handler, owners: [], logger });
    expect(fake.updates).toEqual([{ content: 'бросок обновлён' }]);
    expect(fake.replies).toEqual([]);
  });

  test('кнопка: падение handleComponent даёт понятную ошибку', async () => {
    const fake = createFakeButtonInteraction({ customId: 'boom:id' });
    const handler: InteractionHandler = {
      handle: async () => undefined,
      handleComponent: async () => { throw new Error('взрыв'); },
    };
    await dispatchInteraction(asButton(fake), {
      handler,
      owners: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(fake.replies).toEqual([
      { content: 'Произошла ошибка при выполнении команды.', flags: 64 },
    ]);
  });
});
