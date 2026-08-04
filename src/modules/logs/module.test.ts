import { describe, expect, test } from 'bun:test';
import { createContext } from '../../core/testing.ts';
import module, {
  buildMemberBanned,
  buildMemberJoined,
  buildMemberLeft,
  buildMemberUnbanned,
  buildMessageDeleted,
  buildMessageEdited,
  buildMessagesBulkDeleted,
  buildNickChanged,
  buildRolesChanged,
  buildTimeoutCleared,
  buildTimeoutSet,
  buildVoiceJoined,
  buildVoiceLeft,
  buildVoiceMoved,
  createLogSink,
  channelNameOf,
  decideMessageDelete,
  decideMessageUpdate,
  escapeMarkdown,
  memberChange,
  parseChannelMention,
  resolveConfigType,
  voiceChange,
  voiceChannelName,
} from './module.ts';

const handler = module.handlers.find((h) => h.name === 'logs')!;

describe('helpers', () => {
  test('parseChannelMention: упоминание и голый ID', () => {
    expect(parseChannelMention('<#123456789012345678>')).toBe('123456789012345678');
    expect(parseChannelMention('123456789012345678')).toBe('123456789012345678');
    expect(parseChannelMention('#general')).toBeNull();
    expect(parseChannelMention('abc')).toBeNull();
  });

  test('resolveConfigType принимает только известные типы', () => {
    expect(resolveConfigType('members')).toBe('members');
    expect(resolveConfigType('punishments')).toBe('punishments');
    expect(resolveConfigType('nope')).toBeNull();
  });

  test('escapeMarkdown экранирует разметку', () => {
    expect(escapeMarkdown('a*b_c')).toBe('a\\*b\\_c');
    expect(escapeMarkdown('обычный')).toBe('обычный');
  });
});

describe('embed builders', () => {
  const user = { id: '111', username: 'Алиса' };

  test('участник вошёл/вышел', () => {
    expect(buildMemberJoined(user)).toMatchObject({ title: '👋 Участник вошёл', color: 0x57f287 });
    expect(buildMemberLeft(user)).toMatchObject({ title: '🚪 Участник вышел', color: 0xed4245 });
  });

  test('удаление сообщения: контент и канал', () => {
    const embed = buildMessageDeleted({ author: user, content: 'секрет', channelName: 'чат' });
    expect(embed.title).toBe('🗑️ Сообщение удалено');
    expect(embed.fields).toContainEqual({ name: 'Содержимое', value: 'секрет' });
  });

  test('редактирование: было → стало', () => {
    const embed = buildMessageEdited({
      author: user,
      oldContent: 'до',
      newContent: 'после',
      channelName: 'чат',
    });
    expect(embed.title).toBe('✏️ Сообщение изменено');
    expect(embed.fields).toContainEqual({ name: 'Было', value: 'до' });
    expect(embed.fields).toContainEqual({ name: 'Стало', value: 'после' });
  });

  test('голос: вход и перемещение', () => {
    expect(buildVoiceJoined({ user, channelName: 'Лобби' })).toMatchObject({
      title: '🔊 Вошёл в голосовой канал',
      fields: [{ name: 'Канал', value: 'Лобби', inline: true }],
    });
    const moved = buildVoiceMoved({ user, from: 'А', to: 'Б' });
    expect(moved.fields).toContainEqual({ name: 'Из', value: 'А', inline: true });
    expect(moved.fields).toContainEqual({ name: 'В', value: 'Б', inline: true });
  });

  test('мод: смена ника', () => {
    const embed = buildNickChanged({ user, old: 'старый', next: 'новый' });
    expect(embed).toMatchObject({ title: '📝 Изменён ник', color: 0xfaa61a });
    expect(embed.fields).toContainEqual({ name: 'Было', value: 'старый', inline: true });
  });

  test('наказания: бан, разбан и тайм-аут', () => {
    expect(buildMemberBanned({ user, reason: 'спам' })).toMatchObject({
      title: '⛔ Пользователь забанен',
      color: 0xed4245,
    });
    const timeout = buildTimeoutSet({ user, until: new Date('2026-01-02T00:00:00Z') });
    expect(timeout.title).toBe('⛔ Тайм-аут (мут)');
    expect(timeout.fields?.[0]?.value).toBe('<t:1767312000:F>');
    expect(buildTimeoutCleared({ user })).toMatchObject({ title: '✅ Тайм-аут снят' });
    expect(buildMemberUnbanned({ user })).toMatchObject({ title: '♻️ Разбан', color: 0x57f287 });
  });

  test('массовое удаление и выход из голосового', () => {
    expect(buildMessagesBulkDeleted({ count: 12, channelName: 'чат' })).toMatchObject({
      title: '🧹 Массовое удаление',
      description: '**12** сообщений в канале чат',
    });
    expect(buildVoiceLeft({ user, channelName: 'Лобби' })).toMatchObject({
      title: '🔇 Вышел из голосового канала',
    });
  });

  test('роли: добавлено/убрано', () => {
    const embed = buildRolesChanged({ user, added: ['Модератор'], removed: ['Новичок'] });
    expect(embed.fields).toContainEqual({ name: 'Добавлено', value: 'Модератор' });
    expect(embed.fields).toContainEqual({ name: 'Убрано', value: 'Новичок' });
  });
});

describe('решающая логика', () => {
  const user = { id: '111', username: 'Алиса' };

  test('decideMessageUpdate: текстовое изменение → эмбед', () => {
    const event = decideMessageUpdate({ content: 'до' }, { content: 'после', author: user });
    expect(event?.type).toBe('messages');
    expect(event?.embeds[0]?.title).toBe('✏️ Сообщение изменено');
  });

  test('decideMessageUpdate: не текстовое изменение → null', () => {
    expect(decideMessageUpdate({ content: 'тот же' }, { content: 'тот же', author: user })).toBeNull();
  });

  test('decideMessageUpdate: бот игнорируется', () => {
    expect(decideMessageUpdate({ content: 'a' }, { content: 'b', isBot: true })).toBeNull();
  });

  test('decideMessageDelete: в гильдии → эмбед, без гильдии → null', () => {
    expect(decideMessageDelete({ guildId: 'g1', content: 'x', author: user })?.type).toBe('messages');
    expect(decideMessageDelete({ content: 'x' })).toBeNull();
  });

  test('voiceChange: вход, выход, перемещение, без изменений', () => {
    expect(voiceChange({}, { channelId: 'v1' })).toEqual({ kind: 'joined', channelId: 'v1' });
    expect(voiceChange({ channelId: 'v1' }, {})).toEqual({ kind: 'left', channelId: 'v1' });
    expect(voiceChange({ channelId: 'v1' }, { channelId: 'v2' })).toEqual({
      kind: 'moved', fromId: 'v1', toId: 'v2',
    });
    expect(voiceChange({ channelId: 'v1' }, { channelId: 'v1' })).toBeNull();
    expect(voiceChange({}, {})).toBeNull();
  });

  test('memberChange: тайм-аут → наказания (сет и снятие)', () => {
    const until = new Date('2026-01-02T00:00:00Z');
    const set = memberChange(user, { roleNames: [] }, { timeoutUntil: until, roleNames: [] });
    expect(set?.type).toBe('punishments');
    expect(set?.embeds[0]?.title).toBe('⛔ Тайм-аут (мут)');
    const cleared = memberChange(user, { timeoutUntil: until, roleNames: [] }, { roleNames: [] });
    expect(cleared?.type).toBe('punishments');
    expect(cleared?.embeds[0]?.title).toBe('✅ Тайм-аут снят');
  });

  test('memberChange: ник → мод-логи', () => {
    const event = memberChange(user, { nickname: 'старый', roleNames: [] }, { nickname: 'новый', roleNames: [] });
    expect(event?.type).toBe('mod');
    expect(event?.embeds[0]?.title).toBe('📝 Изменён ник');
  });

  test('memberChange: роли → мод-логи, без изменений → null', () => {
    const event = memberChange(user, { roleNames: ['A'] }, { roleNames: ['A', 'B'] });
    expect(event?.type).toBe('mod');
    expect(event?.embeds[0]?.title).toBe('🎭 Изменены роли');
    expect(memberChange(user, { roleNames: ['A'] }, { roleNames: ['A'] })).toBeNull();
  });

  test('channelNameOf: имя из объекта канала', () => {
    expect(channelNameOf({ name: 'чат' })).toBe('чат');
    expect(channelNameOf({ name: 42 })).toBeUndefined();
    expect(channelNameOf(null)).toBeUndefined();
    expect(channelNameOf('не канал')).toBeUndefined();
  });

  test('voiceChannelName: имя из кэша по ID', () => {
    const guild = { channels: { cache: { get: (id: string) => (id === 'v1' ? { name: 'Лобби' } : undefined) } } };
    expect(voiceChannelName(guild, 'v1')).toBe('Лобби');
    expect(voiceChannelName(guild, 'nope')).toBeUndefined();
  });
});

describe('/logs', () => {
  test('объявляет предусловия guildOnly + ManageGuild', () => {
    expect(handler.preconditions).toEqual([
      { type: 'guildOnly' },
      { type: 'permissions', permissions: ['ManageGuild'] },
    ]);
  });

  test('set сохраняет канал в store, show показывает, clear убирает', async () => {
    const ctx = createContext();
    const run = (args: Record<string, unknown>) =>
      handler.run({ ...ctx, args } as Parameters<typeof handler.run>[0]);

    const set = await run({ action: 'set', type: 'members', channel: '<#123456789012345678>' });
    expect(set).toEqual({ kind: 'message', content: '📝 Лог «members» → <#123456789012345678>' });
    expect(await ctx.store.get<{ members: string }>('config:guild1')).toEqual({ members: '123456789012345678' });

    const show = await run({ action: 'show' });
    if (show.kind === 'message') {
      expect(show.content).toContain('**members** → <#123456789012345678>');
      expect(show.content).toContain('**mod** — не настроен');
    }

    const clear = await run({ action: 'clear', type: 'members' });
    expect(clear).toEqual({ kind: 'message', content: 'Лог «members» очищен' });
    expect(await ctx.store.get<Record<string, never>>('config:guild1')).toEqual({});
  });

  test('set с неизвестным типом — ошибка', async () => {
    const ctx = createContext();
    const result = await handler.run({
      ...ctx,
      args: { action: 'set', type: 'nope', channel: '<#123>' },
    } as Parameters<typeof handler.run>[0]);
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
  });

  test('set с невалидным каналом — ошибка', async () => {
    const ctx = createContext();
    const result = await handler.run({
      ...ctx,
      args: { action: 'set', type: 'mod', channel: '#чат' },
    } as Parameters<typeof handler.run>[0]);
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
  });

  test('clear ненастроенного лога — сообщение', async () => {
    const ctx = createContext();
    const result = await handler.run({
      ...ctx,
      args: { action: 'clear', type: 'voice' },
    } as Parameters<typeof handler.run>[0]);
    if (result.kind === 'message') expect(result.content).toContain('и так не настроен');
  });

  test('в ДМ настройка отклоняется', async () => {
    const ctx = createContext({ input: { commandName: 'logs', args: {}, author: { id: 'u', username: 'U' }, channel: { id: 'dm' } } });
    const result = await handler.run({
      ...ctx,
      args: { action: 'set', type: 'mod', channel: '<#1>' },
    } as Parameters<typeof handler.run>[0]);
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result.kind === 'message') expect(result.content).toContain('только на сервере');
  });
});

describe('createLogSink', () => {
  const event = { type: 'members' as const, embeds: [buildMemberJoined({ id: '1', username: 'A' })] };

  test('null-событие — без доставки', async () => {
    const send = jestSend();
    const sink = createLogSink({ fetchChannel: send.fetch, warn: () => {} });
    await sink('g1', null);
    expect(send.calls).toBe(0);
  });

  test('без канала в конфиге — молча пропускает', async () => {
    const send = jestSend();
    const sink = createLogSink({ fetchChannel: async () => null, warn: () => {} });
    await sink('g1', event);
    expect(send.calls).toBe(0);
  });

  test('доставляет эмбеды в канал', async () => {
    const send = jestSend({ channelId: 'c1' });
    const sink = createLogSink({ fetchChannel: send.fetch, warn: () => {} });
    await sink('g1', event);
    expect(send.calls).toBe(1);
    expect(send.payloads[0]).toEqual({ embeds: event.embeds });
  });

  test('ошибка доставки → warn, не падает', async () => {
    const send = jestSend({ channelId: 'c1', throw: new Error('boom') });
    const warns: string[] = [];
    const sink = createLogSink({
      fetchChannel: send.fetch,
      warn: (msg, err) => warns.push(`${msg}:${String(err)}`),
    });
    await sink('g1', event);
    expect(warns).toEqual(['logs: не удалось доставить:Error: boom']);
  });
});

function jestSend(options: { channelId?: string; throw?: unknown } = {}) {
  const payloads: { embeds: unknown[] }[] = [];
  let calls = 0;
  const fetch = async () =>
    options.channelId
      ? {
          send: async (payload: { embeds: unknown[] }) => {
            calls += 1;
            payloads.push(payload);
            if (options.throw) throw options.throw;
          },
        }
      : null;
  return { fetch, get calls() { return calls; }, payloads };
}
