import type { ArgsOf, ArgsSchema } from './args.ts';
import type { ServiceMap } from './service.ts';
import type {
  Capability,
  PreconditionSpec,
  Result,
} from './types.ts';

export interface HandlerRunContext {
  input: import('./types.ts').Input;
  store: import('./types.ts').Store;
  memory: import('./types.ts').ChannelMemory;
  logger: import('./types.ts').Logger;
  services: ServiceMap;
}

export interface HandlerDef<A extends ArgsSchema = ArgsSchema> {
  name: string;
  /** Обязательное поле: питает /help и автоподстановку slash-команд. */
  description: string;
  args?: A;
  preconditions?: PreconditionSpec[];
  capabilities?: Capability[];
  /** Кнопки, которые хэндлер может рендерить и обрабатывать (клики). */
  components?: ComponentHandlerDef[];
  run: (ctx: HandlerRunContext & { args: ArgsOf<A> }) => Result | Promise<Result>;
}

export interface Handler<A extends ArgsSchema = ArgsSchema> {
  readonly name: string;
  readonly description: string;
  readonly args: A;
  readonly preconditions: PreconditionSpec[];
  readonly capabilities: Capability[];
  readonly components: ComponentHandlerDef[];
  readonly run: (ctx: HandlerRunContext & { args: ArgsOf<A> }) => Result | Promise<Result>;
}

/** Атомарное поведение: имя, схема аргументов, предусловия, capabilities, описание. */
export function defineHandler<A extends ArgsSchema>(def: HandlerDef<A>): Handler<A> {
  return {
    name: def.name,
    description: def.description,
    args: (def.args ?? {}) as A,
    preconditions: def.preconditions ?? [],
    capabilities: def.capabilities ?? [],
    components: def.components ?? [],
    run: def.run,
  };
}

/** Контекст нажатия кнопки. Наследует HandlerRunContext; `input` — вызов от имени хэндлера. */
export interface ComponentRunContext extends HandlerRunContext {
  /** Полный customId нажатой кнопки: <handler>:<component>[:<payload>]. */
  customId: string;
  /** Часть customId после "<handler>:<component>:" (пустая строка, если её нет). */
  payload: string;
}

/**
 * Кнопка, на которую подписан Handler: `id` — префикс кнопки до первого ':'.
 * Клик `roll:step:2` направит в компонент `step` с payload `'2'`.
 */
export interface ComponentHandlerDef {
  /** Идентификатор компонента (без ':'). Совпадает с префиксом `id` кнопки в Result. */
  id: string;
  description?: string;
  preconditions?: PreconditionSpec[];
  capabilities?: Capability[];
  run(ctx: ComponentRunContext): Result | Promise<Result>;
}
