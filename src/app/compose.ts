import { createGateway } from '../core/discord/gateway.ts';
import { createLogger } from '../core/internal/logger.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import { Registry } from '../core/internal/registry.ts';
import { FileStore, InMemoryChannelMemory } from '../core/internal/store.ts';
import type { Logger } from '../core/types.ts';
import { InteractionInteractor } from './interactor.ts';
import { Lifecycle } from './lifecycle.ts';
import type { BotConfig } from '../core/internal/config.ts';

export interface AppContext {
  lifecycle: Lifecycle;
  interactor: InteractionInteractor;
  registry: Registry;
  logger: Logger;
}

export interface ComposeOptions {
  modulesDir?: string;
  dataDir?: string;
  /** false — не подключаться к Discord и не логиниться (офлайн/тесты). */
  syncSlashCommands?: boolean;
  logger?: Logger;
}

/**
 * Composition root: собирает всё приложение из BotConfig (ручной DI).
 * Только здесь создаются конкретные реализации; остальное объявляет зависимости.
 */
export function composeApp(config: BotConfig, options: ComposeOptions = {}): AppContext {
  const logger = options.logger ?? createLogger('app', config.logLevel ?? 'info');
  const registry = new Registry();
  const pipeline = new Pipeline();
  const memory = new InMemoryChannelMemory();
  const stores = new Map<string, FileStore>();

  const interactor = new InteractionInteractor({
    registry,
    pipeline,
    memory,
    logger,
    storeFor: (moduleName) => stores.get(moduleName),
  });

  const lifecycle = new Lifecycle({
    registry,
    pipeline,
    memory,
    logger,
    config,
    modulesDir: options.modulesDir ?? 'src/modules',
    dataDir: options.dataDir ?? '.data',
    stores,
    gatewayFactory: options.syncSlashCommands === false
      ? undefined
      : (onReady) => createGateway({
          logger,
          owners: config.owners ?? [],
          handler: interactor,
          onReady,
        }),
  });

  return { lifecycle, interactor, registry, logger };
}
