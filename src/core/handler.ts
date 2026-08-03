import type { ArgsOf, ArgsSchema } from './args.ts';
import type { ServiceMap } from './service.ts';
import type { Capability, PreconditionSpec, Result } from './types.ts';

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
  run: (ctx: HandlerRunContext & { args: ArgsOf<A> }) => Result | Promise<Result>;
}

export interface Handler<A extends ArgsSchema = ArgsSchema> {
  readonly name: string;
  readonly description: string;
  readonly args: A;
  readonly preconditions: PreconditionSpec[];
  readonly capabilities: Capability[];
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
    run: def.run,
  };
}
