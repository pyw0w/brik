import type { z } from 'zod';
import type { ChannelMemory, Logger } from './types.ts';

/** Регистр типов сервисов; расширяется сервисами через `declare module` в их service.ts. */
export interface ServiceMap {}

export interface ServiceInitContext<O = unknown> {
  options: O;
  logger: Logger;
  memory: ChannelMemory;
}

export interface ServiceDef<O = undefined> {
  name: string;
  description?: string;
  optionsSchema?: z.ZodType;
  init(ctx: ServiceInitContext<O>): unknown | Promise<unknown>;
  close?(service: unknown): void | Promise<void>;
}

export interface Service<O = undefined> {
  readonly name: string;
  readonly description?: string;
  readonly optionsSchema?: z.ZodType;
  readonly init: (ctx: ServiceInitContext<O>) => unknown | Promise<unknown>;
  readonly close?: (service: unknown) => void | Promise<void>;
}

export function defineService<O = undefined>(def: ServiceDef<O>): Service<O> {
  return {
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    ...(def.optionsSchema !== undefined ? { optionsSchema: def.optionsSchema } : {}),
    init: def.init,
    ...(def.close !== undefined ? { close: def.close } : {}),
  };
}
