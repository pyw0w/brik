import type { InteractionEnv, ComponentClick } from '../core/discord/adapter.ts';
import { capabilityLabel, Pipeline } from '../core/internal/pipeline.ts';
import type { Registry } from '../core/internal/registry.ts';
import type {
  Capability,
  ChannelMemory,
  Input,
  Logger,
  Result,
  Store,
} from '../core/types.ts';
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
      const pre = await this.deps.pipeline.checkPreconditions(handler.preconditions, ctx, env.preconditions);
      if (!pre.ok) {
        return { kind: 'message', content: pre.reason ?? 'Нет доступа', ephemeral: true };
      }

      const missing = this.deps.pipeline.missingCapabilities(handler.capabilities, env.granted);
      if (missing.length > 0) {
        return { kind: 'message', content: capabilityError(missing), ephemeral: true };
      }

      return withCustomIds(await this.deps.pipeline.run(handler, ctx), handler.name);
    } catch (err) {
      this.deps.logger.error(`Ошибка команды /${handler.name}`, err);
      return {
        kind: 'message',
        content: 'Произошла ошибка при выполнении команды.',
        ephemeral: true,
      };
    }
  }

  /**
   * Обрабатывает нажатие кнопки: роутинг customId → предусловия → capabilities → run.
   * `input` для предусловий строится от имени хэндлера-владельца кнопки.
   */
  async handleComponent(click: ComponentClick, env: InteractionEnv): Promise<Result | undefined> {
    const found = this.deps.registry.findComponent(click.customId);
    if (!found) return undefined;
    const { module, handler, component, payload } = found;
    const store = this.deps.storeFor(module.name);
    if (!store) return undefined;

    const ctx = {
      input: {
        commandName: handler.name,
        args: {},
        author: click.author,
        channel: click.channel,
      },
      store,
      memory: this.deps.memory,
      logger: this.deps.logger,
      services: this.deps.servicesFor(module.name),
      customId: click.customId,
      payload,
    };

    try {
      const pre = await this.deps.pipeline.checkPreconditions(component.preconditions ?? [], ctx, env.preconditions);
      if (!pre.ok) {
        return { kind: 'message', content: pre.reason ?? 'Нет доступа', ephemeral: true };
      }

      const missing = this.deps.pipeline.missingCapabilities(component.capabilities ?? [], env.granted);
      if (missing.length > 0) {
        return { kind: 'message', content: capabilityError(missing), ephemeral: true };
      }

      return withCustomIds(await component.run(ctx), handler.name);
    } catch (err) {
      this.deps.logger.error(`Ошибка кнопки ${click.customId}`, err);
      return {
        kind: 'message',
        content: 'Произошла ошибка при выполнении команды.',
        ephemeral: true,
      };
    }
  }
}

function capabilityError(missing: readonly Capability[]): string {
  const list = missing.map(capabilityLabel).join(', ');
  return `У бота нет прав в этом канале: ${list}. Выдайте их и повторите команду.`;
}

/**
 * Проставляет реальные customId кнопкам в Result: <handler>:<id>.
 * Рекурсивно для multiple/update; link-кнопки (url) пропускаются.
 */
export function withCustomIds(result: Result, handlerName: string): Result {
  switch (result.kind) {
    case 'component':
      return {
        ...result,
        rows: result.rows.map((row) => ({
          buttons: row.buttons.map((b) =>
            b.url || !b.id ? b : { ...b, id: `${handlerName}:${b.id}` },
          ),
        })),
      };
    case 'multiple':
      return { ...result, results: result.results.map((r) => withCustomIds(r, handlerName)) };
    case 'update':
      return {
        ...result,
        result: withCustomIds(result.result, handlerName) as Exclude<Result, { kind: 'update' }>,
      };
    default:
      return result;
  }
}
