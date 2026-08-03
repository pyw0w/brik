import { z } from 'zod';

/** Тип опции в терминах Discord (строковый тег; маппинг на enum — в discord/registrar). */
export type ArgOptionType = 'string' | 'number' | 'integer' | 'boolean';

export interface ArgSpec<S extends z.ZodType = z.ZodType> {
  description: string;
  schema: S;
  discordType: ArgOptionType;
  required: boolean;
  choices?: string[];
  /** Аргумент опционален; при отсутствии берётся значение по умолчанию. */
  default<D extends z.infer<S>>(value: D): ArgSpec<z.ZodDefault<S>>;
  /** Аргумент опционален (может быть не передан). */
  optional(): ArgSpec<z.ZodOptional<S>>;
}

export type ArgsSchema = Record<string, ArgSpec>;

export type ArgsOf<S extends ArgsSchema> = {
  [K in keyof S]: z.infer<S[K]['schema']>;
};

function spec<S extends z.ZodType>(description: string, schema: S, discordType: ArgOptionType, choices?: string[]): ArgSpec<S> {
  return {
    description,
    schema,
    discordType,
    required: !isOptional(schema),
    ...(choices ? { choices } : {}),
    default: <D extends z.infer<S>>(value: D) =>
      spec(description, schema.default(value as never), discordType, choices),
    optional: () => spec(description, schema.optional(), discordType, choices),
  };
}

/** Декларация аргумента slash-команды; тип значения задаётся схемой zod. */
export const arg = {
  string: (description: string) =>
    spec(description, z.string(), 'string'),

  number: (description: string) =>
    spec(description, z.number(), 'number'),

  integer: (description: string) =>
    spec(description, z.number().int(), 'integer'),

  boolean: (description: string) =>
    spec(description, z.boolean(), 'boolean'),

  enum: <T extends [string, ...string[]]>(description: string, values: T) =>
    spec(description, z.enum(values), 'string', values),
};

function isOptional(schema: z.ZodType): boolean {
  return schema.isOptional() || schema instanceof z.ZodDefault;
}

/** Парсит сырые аргументы взаимодействия через схему (применяет дефолты). */
export function parseArgs<S extends ArgsSchema>(
  args: S,
  raw: Record<string, unknown>,
): ArgsOf<S> {
  const out: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(args)) {
    const value = raw[name];
    out[name] = value === undefined ? a.schema.parse(undefined) : a.schema.parse(value);
  }
  return out as ArgsOf<S>;
}
