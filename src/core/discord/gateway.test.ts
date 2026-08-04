import { afterAll, describe, expect, mock, test } from 'bun:test';
import { Client, SlashCommandBuilder, type ClientUser } from 'discord.js';
import { createFakeInteraction } from '../testing.ts';
import { createGateway, type GatewayDeps } from './gateway.ts';

const clients: Client[] = [];

function silentLogger(): GatewayDeps['logger'] {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function makeDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    logger: silentLogger(),
    owners: [],
    handler: { handle: async () => ({ kind: 'message', content: 'ок' }), handleComponent: async () => undefined },
    onReady: async () => {},
    ...overrides,
  };
}

afterAll(() => {
  for (const client of clients) client.destroy().catch(() => undefined);
});

describe('createGateway', () => {
  test('интенты и партиалы покрывают события логов', () => {
    const gateway = createGateway(makeDeps());
    clients.push(gateway.client);
    const bits = gateway.client.options.intents.bitfield;
    expect(bits & 1).toBe(1); // Guilds
    expect(bits & 2).toBe(2); // GuildMembers
    expect(bits & 4).toBe(4); // GuildModeration
    expect(bits & 512).toBe(512); // GuildMessages
    expect(bits & 128).toBe(128); // GuildVoiceStates
    expect(bits & 32768).toBe(32768); // MessageContent
    expect(gateway.client.options.partials).toContain(3); // Message
  });

  test('ready вызывает onReady и логирует имя бота', () => {
    const logger = { ...silentLogger(), info: mock(() => {}) };
    const onReady = mock(async (_client: Client) => {});
    const gateway = createGateway(makeDeps({ logger, onReady }));
    clients.push(gateway.client);

    gateway.client.emit('clientReady' as never);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(gateway.client);
    expect(logger.info).toHaveBeenCalledWith('Подключено как ?');
  });

  test('ready логирует тег бота, когда он известен', () => {
    const logger = { ...silentLogger(), info: mock(() => {}) };
    const gateway = createGateway(makeDeps({ logger }));
    clients.push(gateway.client);
    Object.defineProperty(gateway.client, 'user', {
      value: { tag: 'Бот#1234' } as ClientUser,
      configurable: true,
    });

    gateway.client.emit('clientReady' as never);

    expect(logger.info).toHaveBeenCalledWith('Подключено как Бот#1234');
  });

  test('interactionCreate диспатчит handler и отвечает', async () => {
    const handle = mock(async () => ({ kind: 'message' as const, content: 'плюс' }));
    const gateway = createGateway(makeDeps({ handler: { handle, handleComponent: async () => undefined } }));
    clients.push(gateway.client);
    const interaction = createFakeInteraction({ commandName: 'ping' });

    gateway.client.emit('interactionCreate', interaction as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(interaction.replies[0]).toEqual({ content: 'плюс' });
  });

  test('start логинится и регистрирует команды глобально', async () => {
    const logger = { ...silentLogger(), info: mock(() => {}) };
    const gateway = createGateway(makeDeps({ logger }));
    clients.push(gateway.client);

    gateway.client.login = mock(async () => 'token') as never;
    const set = mock(async () => {});
    Object.defineProperty(gateway.client, 'application', {
      value: { commands: { set } },
      configurable: true,
    });

    const commands = [new SlashCommandBuilder().setName('ping').setDescription('pong')];
    await gateway.start('token', commands);

    expect(gateway.client.login).toHaveBeenCalledWith('token');
    expect(set).toHaveBeenCalledWith(commands);
    expect(logger.info).toHaveBeenCalledWith('Зарегистрировано 1 команд глобально');
  });

  test('start с devGuildId регистрирует на гильду', async () => {
    const logger = { ...silentLogger(), info: mock(() => {}) };
    const gateway = createGateway(makeDeps({ logger }));
    clients.push(gateway.client);

    gateway.client.login = mock(async () => 'token') as never;
    Object.defineProperty(gateway.client, 'application', {
      value: { commands: { set: mock(async () => {}) } },
      configurable: true,
    });
    const set = mock(async () => {});
    gateway.client.guilds.fetch = mock(async () => ({ commands: { set } })) as never;

    const commands = [new SlashCommandBuilder().setName('ping').setDescription('pong')];
    await gateway.start('token', commands, 'guild1');

    expect(gateway.client.guilds.fetch).toHaveBeenCalledWith('guild1');
    expect(set).toHaveBeenCalledWith(commands);
    expect(logger.info).toHaveBeenCalledWith('Зарегистрировано 1 команд на гильду guild1');
  });

  test('destroy вызывает client.destroy', async () => {
    const gateway = createGateway(makeDeps());
    clients.push(gateway.client);
    gateway.client.destroy = mock(async () => {});

    await gateway.destroy();

    expect(gateway.client.destroy).toHaveBeenCalledTimes(1);
  });
});
