import type { Client } from 'discord.js';
import type { z } from 'zod';
import type { Gateway } from '../core/discord/gateway.ts';
import { toSlashCommand } from '../core/discord/registrar.ts';
import { envToken, type BotConfig, type ModuleEntry } from '../core/internal/config.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import type { Registry } from '../core/internal/registry.ts';
import type { ServiceRegistry } from '../core/internal/service-registry.ts';
import { FileStore } from '../core/internal/store.ts';
import type { Module } from '../core/module.ts';
import type { Service, ServiceMap } from '../core/service.ts';
import type { ChannelMemory, CommandCatalog, Logger } from '../core/types.ts';

export interface LifecycleDeps {
  registry: Registry;
  pipeline: Pipeline;
  memory: ChannelMemory;
  logger: Logger;
  config: BotConfig;
  modulesDir: string;
  servicesDir: string;
  dataDir: string;
  stores: Map<string, FileStore>;
  serviceRegistry: ServiceRegistry;
  services: Map<string, unknown>;
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
    await this.deps.serviceRegistry.discover(this.deps.servicesDir);
    this.enabledModules = this.resolveEnabledModules();
    logger.info(
      `Обнаружено модулей: ${registry.size}, включено: ${this.enabledModules.length}`,
    );

    await this.initServices();

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
    for (const [name, api] of [...this.deps.services].reverse()) {
      const svc = this.deps.serviceRegistry.find(name);
      if (!svc?.close) continue;
      try {
        await svc.close(api);
      } catch (err) {
        this.deps.logger.error(`close сервиса "${name}" упал`, err);
      }
    }
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
      const ctx = { store, memory: this.deps.memory, logger: this.deps.logger, commands: this.commands, services: this.servicesMap() };
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
          services: this.servicesMap(),
        });
      } catch (err) {
        this.deps.logger.error(`onReady модуля "${mod.name}" упал`, err);
      }
    }
  }

  private servicesMap(): ServiceMap {
    return Object.fromEntries(this.deps.services) as ServiceMap;
  }

  private async initServices(): Promise<void> {
    const needed = new Set<string>();
    for (const mod of this.enabledModules) {
      for (const name of mod.services ?? []) needed.add(name);
    }
    for (const name of needed) {
      const svc = this.deps.serviceRegistry.find(name) as Service<unknown> | undefined;
      if (!svc) throw new Error(`Сервис "${name}" объявлен модулями, но не найден в src/services`);
      const entry = this.deps.config.services?.[name];
      if (entry && entry.enabled === false) {
        throw new Error(`Сервис "${name}" отключён в конфиге, но нужен модулю`);
      }
      const options = this.serviceOptions(svc, entry);
      try {
        const api = await svc.init({ options, logger: this.deps.logger, memory: this.deps.memory });
        this.deps.services.set(name, api);
      } catch (err) {
        throw new Error(`Сервис "${name}": init упал: ${String(err)}`);
      }
    }
  }

  private serviceOptions(svc: Service<unknown>, entry: ModuleEntry | undefined): unknown {
    const schema = svc.optionsSchema as z.ZodType | undefined;
    const raw = entry?.options ?? {};
    if (!schema) return raw;
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Опции сервиса "${svc.name}" невалидны: ${issues}`);
    }
    return result.data;
  }
}
