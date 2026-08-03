// Публичный контракт ядра. Единственная точка входа для модулей.
// Внутренности (internal/, discord/) сюда не попадают — см. docs/guides/module-api.md.
export { arg } from './args.ts';
export type { ArgSpec, ArgOptionType, ArgsOf, ArgsSchema } from './args.ts';

export { defineHandler } from './handler.ts';
export type { Handler, HandlerDef, HandlerRunContext } from './handler.ts';

export { defineService } from './service.ts';
export type { Service, ServiceDef, ServiceInitContext, ServiceMap } from './service.ts';

export { defineModule } from './module.ts';
export type {
  Module,
  ModuleDef,
  ModuleOptions,
  ModuleSetupContext,
  ModuleReadyContext,
} from './module.ts';

export { CHANNEL_CAPABILITIES } from './types.ts';
export type {
  Capability,
  ChannelMemory,
  ChannelRef,
  CommandCatalog,
  CommandInfo,
  Input,
  Logger,
  PreconditionContext,
  PreconditionHandler,
  PreconditionOutcome,
  PreconditionSpec,
  Result,
  Store,
  UserRef,
} from './types.ts';
