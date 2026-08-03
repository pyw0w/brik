import type { Handler } from './handler.ts';
import { createLogger } from './internal/logger.ts';
import { Pipeline } from './internal/pipeline.ts';
import { InMemoryChannelMemory, MemoryStore } from './internal/store.ts';
import type { Input, Result } from './types.ts';

export interface TestContext {
  input: Input;
  store: MemoryStore;
  memory: InMemoryChannelMemory;
  logger: ReturnType<typeof createLogger>;
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
    ...overrides,
  };
}

/**
 * Прогоняет Handler через реальный Pipeline (парсинг аргументов + run).
 * Поведение — как у живого бота: args парсятся схемой, применяются дефолты.
 */
export async function runHandler(
  handler: Handler,
  options: { input?: Input; args?: Record<string, unknown> } = {},
): Promise<Result> {
  const base = createContext();
  const input = options.input ?? { ...base.input, args: options.args ?? {} };
  return new Pipeline().run(handler, { ...base, input });
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
  reply(payload: unknown): Promise<void>;
  followUp(payload: unknown): Promise<void>;
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
    reply: async (payload) => { replies.push(payload); },
    followUp: async (payload) => { followUps.push(payload); },
  };
}
