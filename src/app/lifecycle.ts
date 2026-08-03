import type { Client } from 'discord.js';
import type { z } from 'zod';
import type { Gateway } from '../core/discord/gateway.ts';
import { toSlashCommand } from '../core/discord/registrar.ts';
import { envToken, type BotConfig, type ModuleEntry } from '../core/internal/config.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import type { Registry } from '../core/internal/registry.ts';
import { FileStore } from '../core/internal/store.ts';
import type { Module } from '../core/module.ts';
import type { ChannelMemory, CommandCatalog, Logger } from '../core/types.ts';

export interface LifecycleDeps {
  registry: Registry;
  pipeline: Pipeline;
  memory: ChannelMemory;
  logger: Logger;
  config: BotConfig;
  modulesDir: string;
  dataDir: string;
  stores: Map<string, FileStore>;
  /** undefined — не подключаться к Discord (режим без сети, тесты). */
  gatewayFactory?: ((onReady: (client: Client) => Promise<void>) => Gateway) | undefined;
}

/** Жизненный цикл: discovery → Enable → setup → login → sync → onReady; shutdown в обратном порядке. */
export class Lifecycle {
  private enabledModules: Module[] = [];
  private gateway?: Gateway;
  private commands: CommandCatalog = { list: () => [] };

  constructor(private readonly deps: LifecycleDeps) {}

  async start(): Promise<void> {
    const { registry, config, logger } = this.deps;

    await registry.discover(this.deps.modulesDir);
    this.enabledModules = this.resolveEnabledModules();
    logger.info(
      `Обнаружено модулей: ${registry.size}, включено: ${this.enabledModules.length}`,
    );

    this.commands = {
      list: () =>
        this.enabledModules
          .flatMap((m) => m.handlers)
          .map((h) => ({ name: h.name, description: h.description })),
    };

    this.runSetup();

    if (!this.deps.gatewayFactory) {
      logger.info('Подключение к Discord пропущено (offline-режим)');
      return;
    }

    this.gateway = this.deps.gatewayFactory((client) => this.runModuleReady(client));

    const commands = this.enabledModules.flatMap((m) => m.handlers).map(toSlashCommand);
    const token = config.token ?? envToken();
    if (!token) throw new Error('Не задан токен: DISCORD_TOKEN или config.token');
    const devGuildId = config.devGuildId ?? process.env.DISCORD_DEV_GUILD_ID;
    await this.gateway.start(token, commands, devGuildId);
  }

  async shutdown(): Promise<void> {
    for (const mod of this.enabledModules) {
      try {
        await mod.onShutdown?.();
      } catch (err) {
        this.deps.logger.error(`onShutdown модуля "${mod.name}" упал`, err);
      }
    }
    this.deps.pipeline.clearCooldowns();
    await this.gateway?.destroy();
  }

  private resolveEnabledModules(): Module[] {
    const enabled: Module[] = [];
    for (const mod of this.deps.registry.getModules()) {
      const entry = this.deps.config.modules[mod.name];
      if (entry && entry.enabled === false) continue;
      this.validateOptions(mod, entry);
      enabled.push(mod);
    }
    for (const name of Object.keys(this.deps.config.modules)) {
      if (!this.deps.registry.findModule(name)) {
        this.deps.logger.warn(`Модуль "${name}" указан в конфиге, но не обнаружен`);
      }
    }
    return enabled;
  }

  private validateOptions(mod: Module, entry: ModuleEntry | undefined): void {
    const schema = mod.optionsSchema as z.ZodType | undefined;
    if (!schema) return;
    const result = schema.safeParse(entry?.options ?? {});
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Опции модуля "${mod.name}" невалидны: ${issues}`);
    }
  }

  private runSetup(): void {
    for (const mod of this.enabledModules) {
      const store = new FileStore(mod.name, this.deps.dataDir);
      this.deps.stores.set(mod.name, store);
      const ctx = { store, memory: this.deps.memory, logger: this.deps.logger, commands: this.commands };
      try {
        mod.setup?.(ctx);
      } catch (err) {
        this.deps.logger.error(`setup модуля "${mod.name}" упал`, err);
      }
    }
  }

  private async runModuleReady(client: Client): Promise<void> {
    for (const mod of this.enabledModules) {
      const store = this.deps.stores.get(mod.name);
      if (!store) continue;
      try {
        await mod.onReady?.({
          client,
          store,
          memory: this.deps.memory,
          logger: this.deps.logger,
          commands: this.commands,
        });
      } catch (err) {
        this.deps.logger.error(`onReady модуля "${mod.name}" упал`, err);
      }
    }
  }
}
