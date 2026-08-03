import type { InteractionEnv } from '../core/discord/adapter.ts';
import { capabilityLabel, Pipeline } from '../core/internal/pipeline.ts';
import type { Registry } from '../core/internal/registry.ts';
import type { ChannelMemory, Input, Logger, Result, Store } from '../core/types.ts';
import type { ServiceMap } from '../core/service.ts';

export interface InteractorDeps {
  registry: Registry;
  pipeline: Pipeline;
  memory: ChannelMemory;
  logger: Logger;
  storeFor(moduleName: string): Store | undefined;
  servicesFor(moduleName: string): ServiceMap;
}

/**
 * Оркестратор вызова команды: найди Handler → предусловия → capabilities → run.
 * Не знает про Discord: работает только с Input/Result и окружением (InteractionEnv).
 */
export class InteractionInteractor {
  constructor(private readonly deps: InteractorDeps) {}

  /** Возвращает Result для доставки; undefined — команда не найдена (молчать). */
  async handle(input: Input, env: InteractionEnv): Promise<Result | undefined> {
    const found = this.deps.registry.findHandler(input.commandName);
    if (!found) return undefined;
    const { module, handler } = found;
    const store = this.deps.storeFor(module.name);
    if (!store) return undefined;

    const ctx = {
      input,
      store,
      memory: this.deps.memory,
      logger: this.deps.logger,
      services: this.deps.servicesFor(module.name),
    };

    try {
      const pre = await this.deps.pipeline.checkPreconditions(handler, ctx, env.preconditions);
      if (!pre.ok) {
        return { kind: 'message', content: pre.reason ?? 'Нет доступа', ephemeral: true };
      }

      const missing = this.deps.pipeline.missingCapabilities(handler, env.granted);
      if (missing.length > 0) {
        const list = missing.map(capabilityLabel).join(', ');
        return {
          kind: 'message',
          content: `У бота нет прав в этом канале: ${list}. Выдайте их и повторите команду.`,
          ephemeral: true,
        };
      }

      return await this.deps.pipeline.run(handler, ctx);
    } catch (err) {
      this.deps.logger.error(`Ошибка команды /${handler.name}`, err);
      return {
        kind: 'message',
        content: 'Произошла ошибка при выполнении команды.',
        ephemeral: true,
      };
    }
  }
}
