import type { Database } from '../core/database.ts';
import { createGateway } from '../core/discord/gateway.ts';
import { SqliteEngine } from '../core/internal/database/engine.ts';
import { ScopedDatabase } from '../core/internal/database/scoped.ts';
import { SqliteStore } from '../core/internal/database/store.ts';
import { createLogger } from '../core/internal/logger.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import { Registry } from '../core/internal/registry.ts';
import { ServiceRegistry } from '../core/internal/service-registry.ts';
import { InMemoryChannelMemory } from '../core/internal/store.ts';
import type { Logger, Store } from '../core/types.ts';
import type { ServiceMap } from '../core/service.ts';
import { InteractionInteractor } from './interactor.ts';
import { Lifecycle } from './lifecycle.ts';
import type { BotConfig } from '../core/internal/config.ts';

export interface AppContext {
  lifecycle: Lifecycle;
  interactor: InteractionInteractor;
  registry: Registry;
  logger: Logger;
  db: Database;
}

export interface ComposeOptions {
  modulesDir?: string;
  dataDir?: string;
  servicesDir?: string;
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
  const stores = new Map<string, Store>();
  const dbs = new Map<string, Database>();
  const services = new Map<string, unknown>();
  const serviceRegistry = new ServiceRegistry();

  const dataDir = options.dataDir ?? '.data';
  const dbPath = config.database?.path ?? `${dataDir}/bot.sqlite`;
  const engine = new SqliteEngine({
    path: dbPath,
    wal: config.database?.wal ?? true,
  });

  const getOrCreateDb = (moduleName: string): Database => {
    let db = dbs.get(moduleName);
    if (!db) {
      db = new ScopedDatabase(engine, `mod_${moduleName}`);
      dbs.set(moduleName, db);
    }
    return db;
  };

  const getOrCreateStore = (moduleName: string): Store => {
    let store = stores.get(moduleName);
    if (!store) {
      const db = getOrCreateDb(moduleName);
      store = new SqliteStore(db, moduleName);
      stores.set(moduleName, store);
    }
    return store;
  };

  const interactor = new InteractionInteractor({
    registry,
    pipeline,
    memory,
    logger,
    storeFor: (moduleName) => getOrCreateStore(moduleName),
    dbFor: (moduleName) => getOrCreateDb(moduleName),
    servicesFor: () => Object.fromEntries(services) as unknown as ServiceMap,
  });

  const lifecycle = new Lifecycle({
    registry,
    pipeline,
    memory,
    logger,
    config,
    modulesDir: options.modulesDir ?? 'src/modules',
    servicesDir: options.servicesDir ?? 'src/services',
    dataDir,
    stores,
    dbs,
    engine,
    serviceRegistry,
    services,
    gatewayFactory: options.syncSlashCommands === false
      ? undefined
      : (onReady) => createGateway({
          logger,
          owners: config.owners ?? [],
          handler: interactor,
          onReady,
        }),
  });

  return { lifecycle, interactor, registry, logger, db: engine };
}
