import type { Client } from 'discord.js';
import type { z } from 'zod';
import type { ChannelMemory, CommandCatalog, Logger, Store } from './types.ts';
import type { Handler } from './handler.ts';
import type { ServiceMap } from './service.ts';

export interface ModuleSetupContext {
  store: Store;
  memory: ChannelMemory;
  logger: Logger;
  /** Читаемый список команд (для /help); источник — Registry включённых модулей. */
  commands: CommandCatalog;
  services: ServiceMap;
}

export interface ModuleReadyContext extends ModuleSetupContext {
  client: Client;
}

export interface ModuleDef<O extends z.ZodType | undefined = undefined> {
  name: string;
  description?: string;
  /** Схема опций модуля; валидирует настройки из bot.config.ts на старте. */
  optionsSchema?: O;
  services?: readonly (keyof ServiceMap)[];
  handlers?: Handler<any>[];
  setup?(ctx: ModuleSetupContext): void | Promise<void>;
  onReady?(ctx: ModuleReadyContext): void | Promise<void>;
  onShutdown?(): void | Promise<void>;
}

export interface Module<O extends z.ZodType | undefined = undefined> {
  readonly name: string;
  readonly description?: string;
  readonly optionsSchema?: O;
  readonly services: readonly string[];
  readonly handlers: Handler<any>[];
  readonly setup?: (ctx: ModuleSetupContext) => void | Promise<void>;
  readonly onReady?: (ctx: ModuleReadyContext) => void | Promise<void>;
  readonly onShutdown?: () => void | Promise<void>;
}

export type ModuleOptions<M> = M extends Module<infer O>
  ? O extends z.ZodType
    ? z.infer<O>
    : undefined
  : never;

/** Единица расширения: самодостаточный пакет Handler-ов + жизненный цикл. */
export function defineModule<O extends z.ZodType | undefined = undefined>(
  def: ModuleDef<O>,
): Module<O> {
  return {
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    ...(def.optionsSchema !== undefined ? { optionsSchema: def.optionsSchema } : {}),
    services: (def.services ?? []) as readonly string[],
    handlers: def.handlers ?? [],
    ...(def.setup !== undefined ? { setup: def.setup } : {}),
    ...(def.onReady !== undefined ? { onReady: def.onReady } : {}),
    ...(def.onShutdown !== undefined ? { onShutdown: def.onShutdown } : {}),
  };
}
