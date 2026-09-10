import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createContext, runHandler } from '../../core/testing.ts';
import {
  CHANNEL_TYPE_GUILD_VOICE,
  createVoiceManager,
  DEFAULT_NAME_TEMPLATE,
  formatChannelName,
  parseChannelMention,
  type ChannelLike,
  type ClientLike,
  type GuildLike,
  type MemberLike,
  type TempChannelRecord,
  type VoiceConfig,
  type VoiceManager,
  type VoiceStateLike,
} from './manager.ts';
import module, { getVoiceManager, setVoiceManagerForTest } from './module.ts';

// ===== Фейки для тестирования =====

function makeFakeChannel(id: string, name: string, membersCount = 0): ChannelLike & { deleted: boolean; deleteReason?: string | undefined } {
  return {
    id,
    name,
    members: { size: membersCount },
    deleted: false,
    async delete(reason?: string) {
      this.deleted = true;
      this.deleteReason = reason;
    },
  };
}

function makeFakeGuild(id: string, channels: Map<string, ChannelLike>): GuildLike & { createdChannels: ChannelLike[] } {
  const createdChannels: ChannelLike[] = [];
  return {
    id,
    createdChannels,
    channels: {
      cache: {
        get: (chId: string) => channels.get(chId),
      },
      fetch: async (chId: string) => {
        const ch = channels.get(chId);
        if (!ch) throw new Error('Unknown Channel');
        return ch;
      },
      create: async (options) => {
        const newId = `new_ch_${channels.size + 1}`;
        const newCh = makeFakeChannel(newId, options.name, 0);
        channels.set(newId, newCh);
        createdChannels.push(newCh);
        return newCh;
      },
    },
  };
}

function makeFakeClient(guilds: Map<string, GuildLike>): ClientLike {
  return {
    guilds: {
      cache: {
        get: (gId: string) => guilds.get(gId),
      },
    },
  };
}

function makeFakeMember(id: string, username: string, currentChannelId: string | null = null): MemberLike & { movedTo: string | null } {
  const mem = {
    id,
    displayName: username,
    user: { id, username },
    movedTo: currentChannelId,
    voice: {
      setChannel: async (channel: ChannelLike | string | null) => {
        const chId = typeof channel === 'string' ? channel : channel ? channel.id : null;
        mem.movedTo = chId;
        if (
          channel &&
          typeof channel === 'object' &&
          'members' in channel &&
          channel.members &&
          typeof channel.members === 'object' &&
          'size' in channel.members &&
          typeof channel.members.size === 'number'
        ) {
          channel.members.size++;
        }
      },
    },
  };
  return mem;
}

describe('модуль voice: хелперы', () => {
  test('parseChannelMention: корректно распознает упоминания и ID', () => {
    expect(parseChannelMention('<#123456789012345678>')).toBe('123456789012345678');
    expect(parseChannelMention('123456789012345678')).toBe('123456789012345678');
    expect(parseChannelMention('  <#987654321098765432>  ')).toBe('987654321098765432');
    expect(parseChannelMention('abc')).toBeNull();
    expect(parseChannelMention('<#abc>')).toBeNull();
    expect(parseChannelMention('123')).toBeNull();
  });

  test('formatChannelName: подставляет имя пользователя в шаблон', () => {
    expect(formatChannelName(undefined, 'Алексей')).toBe('🔊 Алексей');
    expect(formatChannelName('Комната {user}', 'Иван')).toBe('Комната Иван');
    expect(formatChannelName('{USER} lounge', 'Дмитрий')).toBe('Дмитрий lounge');
    expect(formatChannelName('', 'Ольга')).toBe('🔊 Ольга');
  });

  test('formatChannelName: обрезает названия длиннее 100 символов', () => {
    const longName = 'A'.repeat(150);
    const result = formatChannelName('🔊 {user}', longName);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.startsWith('🔊 ')).toBe(true);
  });

  test('структурные хелперы asChannelLike, asGuildLike, channelMembersCount', () => {
    const { asChannelLike, asGuildLike, channelMembersCount } = require('./manager.ts');
    expect(asChannelLike(null)).toBeNull();
    expect(asChannelLike(123)).toBeNull();
    expect(asChannelLike({ id: 123 })).toBeNull();
    expect(asChannelLike({ id: 'ch_1' })).toEqual({ id: 'ch_1' });

    expect(asGuildLike(null)).toBeNull();
    expect(asGuildLike({ id: 'g1' })).toBeNull();
    expect(asGuildLike({ id: 'g1', channels: {} })).toBeDefined();

    expect(channelMembersCount({ id: 'c1' })).toBe(0);
    expect(channelMembersCount({ id: 'c1', members: null })).toBe(0);
    expect(channelMembersCount({ id: 'c1', members: { size: 5 } })).toBe(5);
  });
});

describe('модуль voice: хэндлер /voice', () => {
  const handler = module.handlers[0]!;

  beforeEach(() => {
    setVoiceManagerForTest(undefined);
  });

  afterEach(() => {
    setVoiceManagerForTest(undefined);
  });

  test('объявляет необходимые предусловия и права', () => {
    expect(handler.preconditions).toEqual([
      { type: 'guildOnly' },
      { type: 'permissions', permissions: ['ManageChannels'] },
    ]);
    expect(handler.capabilities).toEqual(['SendMessages']);
  });

  test('setup: валидирует наличие аргументов category и trigger', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      args: { action: 'setup' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.ephemeral).toBe(true);
      expect(res.content).toContain('укажите оба параметра');
    }
  });

  test('setup: валидирует формат ID', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      args: { action: 'setup', category: 'invalid', trigger: 'invalid' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.ephemeral).toBe(true);
      expect(res.content).toContain('Неверный формат ID');
    }
  });

  test('setup: сохраняет настройки в store', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      args: {
        action: 'setup',
        category: '111111111111111111',
        trigger: '<#222222222222222222>',
        name: 'Комната {user}',
      },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('Временные голосовые каналы настроены');
      expect(res.content).toContain('111111111111111111');
      expect(res.content).toContain('222222222222222222');
    }

    const saved = await ctx.store.get<VoiceConfig>('config:guild1');
    expect(saved).toEqual({
      categoryId: '111111111111111111',
      triggerChannelId: '222222222222222222',
      nameTemplate: 'Комната {user}',
    });
  });

  test('show: показывает статус, когда не настроено', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      args: { action: 'show' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('не настроены');
    }
  });

  test('show: показывает текущие настройки и число активных каналов', async () => {
    const ctx = createContext();
    await ctx.store.set('config:guild1', {
      categoryId: '111111111111111111',
      triggerChannelId: '222222222222222222',
      nameTemplate: '🔊 {user}',
    });

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'ch1',
      guildId: 'guild1',
      ownerId: 'u1',
      categoryId: '111111111111111111',
      createdAt: Date.now(),
    });

    const res = await runHandler(handler, {
      args: { action: 'show' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('111111111111111111');
      expect(res.content).toContain('222222222222222222');
      expect(res.content).toContain('Активных комнат: **1**');
    }
  });

  test('clear: удаляет настройки из store', async () => {
    const ctx = createContext();
    await ctx.store.set('config:guild1', {
      categoryId: '111111111111111111',
      triggerChannelId: '222222222222222222',
    });

    const res = await runHandler(handler, {
      args: { action: 'clear' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('удалены');
    }

    expect(await ctx.store.get('config:guild1')).toBeUndefined();
  });

  test('в ДМ возвращает ошибку сервера', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      input: { ...ctx.input, channel: { id: 'dm1' } },
      args: { action: 'show' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('только на сервере');
    }
  });

  test('clear: сообщает если уже не настроено', async () => {
    const ctx = createContext();
    const res = await runHandler(handler, {
      args: { action: 'clear' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('и так не настроены');
    }
  });

  test('cleanup: без активного VoiceManager возвращает число каналов из БД', async () => {
    const ctx = createContext();
    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'ch1',
      guildId: 'guild1',
      ownerId: 'u1',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });

    const res = await runHandler(handler, {
      args: { action: 'cleanup' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('В БД зарегистрировано **1** временных каналов');
    }
  });

  test('cleanup: вызывает cleanupGuild если активен VoiceManager', async () => {
    const ctx = createContext();
    const mockCleanup = mock(async (_guildId: string) => 3);
    setVoiceManagerForTest({
      recover: async () => ({ deleted: 0, preserved: 0 }),
      handleVoiceState: async () => {},
      handleChannelDelete: async () => {},
      cleanupGuild: mockCleanup,
      dispose: () => {},
    });

    const res = await runHandler(handler, {
      args: { action: 'cleanup' },
      store: ctx.store,
      db: ctx.db,
    });

    expect(mockCleanup).toHaveBeenCalledWith('guild1');
    expect(res.kind).toBe('message');
    if (res.kind === 'message') {
      expect(res.content).toContain('удалено каналов — **3**');
    }
  });
});

describe('VoiceManager: восстановление и управление каналами', () => {
  test('recover: удаляет пустые каналы и записи из БД, сохраняет занятые', async () => {
    const ctx = createContext();
    const channels = new Map<string, ChannelLike>();
    const chEmpty = makeFakeChannel('ch_empty', 'Пустой войс', 0);
    const chActive = makeFakeChannel('ch_active', 'Активный войс', 2);
    channels.set('ch_empty', chEmpty);
    channels.set('ch_active', chActive);

    const guild = makeFakeGuild('g1', channels);
    const client = makeFakeClient(new Map([['g1', guild]]));

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'ch_empty',
      guildId: 'g1',
      ownerId: 'u1',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });
    await col.insert({
      channelId: 'ch_active',
      guildId: 'g1',
      ownerId: 'u2',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });
    await col.insert({
      channelId: 'ch_nonexistent',
      guildId: 'g1',
      ownerId: 'u3',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });

    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    const result = await manager.recover();
    expect(result.deleted).toBe(2); // ch_empty и ch_nonexistent
    expect(result.preserved).toBe(1); // ch_active

    expect(chEmpty.deleted).toBe(true);
    expect(chActive.deleted).toBe(false);

    const remaining = await col.find();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.channelId).toBe('ch_active');
  });

  test('handleVoiceState: вход в триггер-канал создаёт комнату и перемещает пользователя', async () => {
    const ctx = createContext();
    const channels = new Map<string, ChannelLike>();
    const triggerChannel = makeFakeChannel('trigger_1', '➕ Создать канал', 1);
    channels.set('trigger_1', triggerChannel);

    const guild = makeFakeGuild('g1', channels);
    const client = makeFakeClient(new Map([['g1', guild]]));

    await ctx.store.set('config:g1', {
      categoryId: 'cat_voice',
      triggerChannelId: 'trigger_1',
      nameTemplate: 'Комната {user}',
    });

    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    const member = makeFakeMember('user_123', 'Александр', 'trigger_1');
    const oldState: VoiceStateLike = { guild, channelId: null, member };
    const newState: VoiceStateLike = { guild, channelId: 'trigger_1', member };

    await manager.handleVoiceState(oldState, newState);

    expect(guild.createdChannels.length).toBe(1);
    const created = guild.createdChannels[0]!;
    expect(created.name).toBe('Комната Александр');

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    const records = await col.find();
    expect(records.length).toBe(1);
    expect(records[0]?.channelId).toBe(created.id);
    expect(records[0]?.ownerId).toBe('user_123');
  });

  test('handleVoiceState: выход из временного канала удаляет его при 0 участников', async () => {
    const ctx = createContext();
    const channels = new Map<string, ChannelLike>();
    const tempChannel = makeFakeChannel('temp_ch', '🔊 Временный', 0);
    channels.set('temp_ch', tempChannel);

    const guild = makeFakeGuild('g1', channels);
    const client = makeFakeClient(new Map([['g1', guild]]));

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'temp_ch',
      guildId: 'g1',
      ownerId: 'u1',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });

    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    const member = makeFakeMember('u1', 'User', null);
    const oldState: VoiceStateLike = { guild, channelId: 'temp_ch', member };
    const newState: VoiceStateLike = { guild, channelId: null, member };

    await manager.handleVoiceState(oldState, newState);

    expect(tempChannel.deleted).toBe(true);
    const remaining = await col.find();
    expect(remaining.length).toBe(0);
  });

  test('handleVoiceState: выход не удаляет канал, если в нём ещё есть участники', async () => {
    const ctx = createContext();
    const channels = new Map<string, ChannelLike>();
    const tempChannel = makeFakeChannel('temp_ch', '🔊 Временный', 1); // остался 1 участник
    channels.set('temp_ch', tempChannel);

    const guild = makeFakeGuild('g1', channels);
    const client = makeFakeClient(new Map([['g1', guild]]));

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'temp_ch',
      guildId: 'g1',
      ownerId: 'u1',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });

    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    const member = makeFakeMember('u1', 'User', null);
    const oldState: VoiceStateLike = { guild, channelId: 'temp_ch', member };
    const newState: VoiceStateLike = { guild, channelId: null, member };

    await manager.handleVoiceState(oldState, newState);

    expect(tempChannel.deleted).toBe(false);
    const remaining = await col.find();
    expect(remaining.length).toBe(1);
  });

  test('handleChannelDelete: удаляет запись из БД при ручном удалении канала', async () => {
    const ctx = createContext();
    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({
      channelId: 'manual_delete_ch',
      guildId: 'g1',
      ownerId: 'u1',
      categoryId: 'cat1',
      createdAt: Date.now(),
    });

    const client = makeFakeClient(new Map());
    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    await manager.handleChannelDelete('manual_delete_ch');
    const remaining = await col.find();
    expect(remaining.length).toBe(0);
  });

  test('cleanupGuild: удаляет пустые каналы гильдии', async () => {
    const ctx = createContext();
    const channels = new Map<string, ChannelLike>();
    const chEmpty = makeFakeChannel('ch1', 'Войс 1', 0);
    const chActive = makeFakeChannel('ch2', 'Войс 2', 3);
    channels.set('ch1', chEmpty);
    channels.set('ch2', chActive);

    const guild = makeFakeGuild('g1', channels);
    const client = makeFakeClient(new Map([['g1', guild]]));

    const col = ctx.db.collection<TempChannelRecord>('temp_channels');
    await col.insert({ channelId: 'ch1', guildId: 'g1', ownerId: 'u1', categoryId: 'cat1', createdAt: Date.now() });
    await col.insert({ channelId: 'ch2', guildId: 'g1', ownerId: 'u2', categoryId: 'cat1', createdAt: Date.now() });

    const manager = createVoiceManager({
      client,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
    });

    const cleaned = await manager.cleanupGuild('g1');
    expect(cleaned).toBe(1);
    expect(chEmpty.deleted).toBe(true);
    expect(chActive.deleted).toBe(false);

    const remaining = await col.find();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.channelId).toBe('ch2');
  });
});

describe('модуль voice: жизненный цикл onReady / onShutdown', () => {
  afterEach(() => {
    module.onShutdown?.();
  });

  test('onReady регистрирует VoiceManager и вызывает recover', async () => {
    const ctx = createContext();
    const events: Record<string, Function> = {};
    const fakeClient = {
      guilds: { cache: new Map() },
      channels: { cache: new Map() },
      on: (event: string, fn: Function) => {
        events[event] = fn;
      },
    };

    await module.onReady?.({
      client: fakeClient as any,
      db: ctx.db,
      store: ctx.store,
      logger: ctx.logger,
      commands: { list: () => [] },
      options: {},
      services: ctx.services,
      memory: ctx.memory,
    });

    expect(getVoiceManager()).toBeDefined();
    expect(events.voiceStateUpdate).toBeDefined();
    expect(events.channelDelete).toBeDefined();

    module.onShutdown?.();
    expect(getVoiceManager()).toBeUndefined();
  });
});
