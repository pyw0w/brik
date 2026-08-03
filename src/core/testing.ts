import type { Handler } from './handler.ts';
import { createLogger } from './internal/logger.ts';
import { Pipeline } from './internal/pipeline.ts';
import { InMemoryChannelMemory, MemoryStore } from './internal/store.ts';
import type { ServiceMap } from './service.ts';
import type { Input, Result } from './types.ts';
export interface TestContext {
  input: Input;
  store: MemoryStore;
  memory: InMemoryChannelMemory;
  logger: ReturnType<typeof createLogger>;
  services: ServiceMap;
}

/** Строит нормализованный Input (по умолчанию — на сервере, без аргументов). */
export function createInput(overrides: Partial<Input> = {}): Input {
  return {
    commandName: 'test',
    args: {},
    author: { id: 'user1', username: 'User' },
    channel: { id: 'channel1', guildId: 'guild1' },
    ...overrides,
  };
}

/** Строит контекст Handler-а: in-memory store, тихая память, заглушенный логгер. */
export function createContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    input: createInput(),
    store: new MemoryStore(),
    memory: new InMemoryChannelMemory(),
    logger: createLogger('test', 'error'),
    services: {} as ServiceMap,
    ...overrides,
  };
}

/**
 * Прогоняет Handler через реальный Pipeline (парсинг аргументов + run).
 * Поведение — как у живого бота: args парсятся схемой, применяются дефолты.
 */
export async function runHandler(
  handler: Handler,
  options: { input?: Input; args?: Record<string, unknown>; services?: ServiceMap } = {},
): Promise<Result> {
  const base = createContext();
  const input = options.input ?? { ...base.input, args: options.args ?? {} };
  const services = options.services ?? base.services;
  return new Pipeline().run(handler, { ...base, input, services });
}

/**
 * Прогоняет component-хэндлер кнопки (как при живом клике):
 * customId строится как <handler>:<id>[:<payload>], если не передан явно.
 */
export async function runComponent(
  handler: Handler,
  options?: { id: string; customId?: string; input?: Input; services?: ServiceMap },
): Promise<Result> {
  const { id, customId, input, services } = options ?? {};
  if (!id) throw new Error('runComponent: укажите id компонента');
  const base = createContext();
  const component = handler.components.find((c) => c.id === id);
  if (!component) {
    throw new Error(`Компонент "${id}" не объявлен в handler "${handler.name}"`);
  }
  const ctxInput = input ?? { ...base.input, commandName: handler.name, args: {} };
  const full = customId ?? `${handler.name}:${id}`;
  const prefix = `${handler.name}:${id}`;
  const payload = full === prefix ? '' : full.slice(prefix.length + 1);
  return component.run({
    ...base,
    input: ctxInput,
    services: services ?? base.services,
    customId: full,
    payload,
  });
}

/** Фейковое ChatInputCommandInteraction для тестов адаптера (каст в тесте). */
export interface FakeInteraction {
  commandName: string;
  options: { data: Array<{ name: string; value: unknown }> };
  user: { id: string; username: string };
  channelId: string;
  guildId?: string;
  memberPermissions?: { has(permission: string): boolean };
  channel: {
    type: number;
    nsfw: boolean;
    permissionsFor(_: unknown): { has(permission: string): boolean };
  };
  guild?: { members: { me: { id: string } } };
  replied: boolean;
  deferred: boolean;
  replies: unknown[];
  followUps: unknown[];
  isChatInputCommand(): true;
  isMessageComponent(): false;
  isButton(): false;
  reply(payload: unknown): Promise<void>;
  followUp(payload: unknown): Promise<void>;
}

/** Фейковое ButtonInteraction для тестов адаптера (каст в тесте). */
export interface FakeButtonInteraction {
  customId: string;
  user: { id: string; username: string };
  channelId: string;
  guildId?: string;
  memberPermissions?: { has(permission: string): boolean };
  channel: {
    type: number;
    nsfw: boolean;
    permissionsFor(_: unknown): { has(permission: string): boolean };
  };
  guild?: { members: { me: { id: string } } };
  replied: boolean;
  deferred: boolean;
  replies: unknown[];
  followUps: unknown[];
  updates: unknown[];
  isChatInputCommand(): false;
  isMessageComponent(): true;
  isButton(): true;
  reply(payload: unknown): Promise<void>;
  followUp(payload: unknown): Promise<void>;
  update(payload: unknown): Promise<void>;
}

/**
 * Строит фейковое нажатие кнопки: reply/followUp/update записывают вызовы.
 * Кастуйте в тесте: `fake as unknown as MessageComponentInteraction`.
 */
export function createFakeButtonInteraction(
  options: {
    customId?: string;
    authorId?: string;
    username?: string;
    channelId?: string;
    guildId?: string;
    dm?: boolean;
    memberPermissions?: string[];
    botPermissions?: string[];
    isNsfw?: boolean;
  } = {},
): FakeButtonInteraction {
  const dm = options.dm ?? false;
  const memberPerms = new Set(options.memberPermissions ?? []);
  const botPerms = new Set(options.botPermissions ?? []);
  const replies: unknown[] = [];
  const followUps: unknown[] = [];
  const updates: unknown[] = [];

  return {
    customId: options.customId ?? 'test:id',
    user: { id: options.authorId ?? 'user1', username: options.username ?? 'User' },
    channelId: options.channelId ?? 'channel1',
    ...(dm ? {} : { guildId: options.guildId ?? 'guild1' }),
    channel: {
      type: dm ? 1 : 0,
      nsfw: options.isNsfw ?? false,
      permissionsFor: () => ({ has: (p) => botPerms.has(p) }),
    },
    ...(dm ? {} : { memberPermissions: { has: (p) => memberPerms.has(p) }, guild: { members: { me: { id: 'bot' } } } }),
    replied: false,
    deferred: false,
    replies,
    followUps,
    updates,
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isButton: () => true,
    reply: async (payload) => { replies.push(payload); },
    followUp: async (payload) => { followUps.push(payload); },
    update: async (payload) => { updates.push(payload); },
  };
}

/**
 * Строит фейковое взаимодействие: reply/followUp записывают вызовы в replies/followUps.
 * Кастуйте в тесте: `fake as unknown as ChatInputCommandInteraction`.
 */
export function createFakeInteraction(
  options: {
    commandName?: string;
    args?: Record<string, unknown>;
    authorId?: string;
    username?: string;
    channelId?: string;
    guildId?: string;
    /** Личное сообщение: без гильды и прав канала. */
    dm?: boolean;
    memberPermissions?: string[];
    botPermissions?: string[];
    isNsfw?: boolean;
  } = {},
): FakeInteraction {
  const dm = options.dm ?? false;
  const memberPerms = new Set(options.memberPermissions ?? []);
  const botPerms = new Set(options.botPermissions ?? []);
  const replies: unknown[] = [];
  const followUps: unknown[] = [];

  return {
    commandName: options.commandName ?? 'test',
    options: {
      data: Object.entries(options.args ?? {}).map(([name, value]) => ({ name, value })),
    },
    user: { id: options.authorId ?? 'user1', username: options.username ?? 'User' },
    channelId: options.channelId ?? 'channel1',
    ...(dm ? {} : { guildId: options.guildId ?? 'guild1' }),
    channel: {
      type: dm ? 1 : 0,
      nsfw: options.isNsfw ?? false,
      permissionsFor: () => ({ has: (p) => botPerms.has(p) }),
    },
    ...(dm ? {} : { memberPermissions: { has: (p) => memberPerms.has(p) }, guild: { members: { me: { id: 'bot' } } } }),
    replied: false,
    deferred: false,
    replies,
    followUps,
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isButton: () => false,
    reply: async (payload) => { replies.push(payload); },
    followUp: async (payload) => { followUps.push(payload); },
  };
}
