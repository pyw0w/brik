import type { EmbedData } from 'discord.js';

/** Право, которое Handler/модуль требует от Bot-а в канале. */
export const CHANNEL_CAPABILITIES = [
  'SendMessages',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
  'ManageMessages',
  'ManageWebhooks',
  'UseExternalEmojis',
  'UseExternalStickers',
] as const;

export type Capability = (typeof CHANNEL_CAPABILITIES)[number];

/** Ссылка на канал без деталей Discord API. */
export interface ChannelRef {
  id: string;
  guildId?: string;
}

/** Автор вызова без деталей Discord API. */
export interface UserRef {
  id: string;
  username: string;
}

/** Нормализованный вызов slash-команды. */
export interface Input {
  commandName: string;
  args: Record<string, unknown>;
  author: UserRef;
  channel: ChannelRef;
}

/** Стиль кнопки (маппинг на discord.js ButtonStyle — в адаптере). */
export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | 'link';

/**
 * Кнопка в ActionRow Result-а kind='component'.
 * `id` — идентификатор компонента (до первого ':') и произвольный payload после ':'
 * (например `'step:1'` → компонент `step` с payload `'1'`). Для link-кнопок `url` обязателен.
 */
export interface ComponentButton {
  id?: string;
  label: string;
  style?: ButtonStyle;
  emoji?: string;
  url?: string;
  disabled?: boolean;
}

/** Один ряд кнопок (максимум 5 кнопок на ряд, 5 рядов на сообщение). */
export interface ComponentRow {
  buttons: ComponentButton[];
}

export type Result =
  | { kind: 'message'; content: string; ephemeral?: boolean }
  | { kind: 'embed'; embed: EmbedData; ephemeral?: boolean }
  | { kind: 'attachment'; file: { name: string; data: Uint8Array }; caption?: string; ephemeral?: boolean }
  | { kind: 'multiple'; results: Result[] }
  | { kind: 'component'; content?: string; rows: ComponentRow[]; ephemeral?: boolean }
  /** Перезаписать сообщение, к которому прикреплены кнопки (только из component-хэндлера). */
  | { kind: 'update'; result: Exclude<Result, { kind: 'update' }> };

export interface PreconditionOutcome {
  ok: boolean;
  reason?: string;
}

export type PreconditionHandler = (
  ctx: PreconditionContext,
) => PreconditionOutcome | Promise<PreconditionOutcome>;

export type PreconditionSpec =
  | { type: 'guildOnly' }
  | { type: 'dmOnly' }
  | { type: 'nsfwOnly' }
  | { type: 'ownerOnly' }
  | { type: 'permissions'; permissions: string[] }
  | { type: 'cooldown'; seconds: number }
  | { type: 'custom'; check: PreconditionHandler };

/** Контекст, видимый предусловию (без результата и ответа). */
export interface PreconditionContext {
  input: Input;
  store: Store;
  memory: ChannelMemory;
  logger: Logger;
}

/** Метаданные одной slash-команды (для /help и каталога). */
export interface CommandInfo {
  name: string;
  description: string;
}

/**
 * Читаемый список команд, которые ядро собрало из включённых модулей.
 * Даётся модулю в контексте (setup/onReady) — источник истины для /help.
 */
export interface CommandCatalog {
  list(): CommandInfo[];
}

/** Персистентный KV-слой модуля (неймспейсирован по имени модуля). */
export interface Store {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/** Диалоговая память по каналу для многошаговых сценариев. */
export interface ChannelMemory {
  get(channelId: string, key: string): Promise<unknown | undefined>;
  set(channelId: string, key: string, value: unknown): Promise<void>;
  delete(channelId: string, key: string): Promise<void>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
}
