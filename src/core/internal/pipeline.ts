import { parseArgs, type ArgsSchema } from '../args.ts';
import type { Handler, HandlerRunContext } from '../handler.ts';
import type { Capability, PreconditionOutcome, PreconditionSpec, Result } from '../types.ts';

export interface PreconditionEnv {
  /** Права участника (строки PermissionFlagsBits), известные из Discord. */
  memberPermissions?: ReadonlySet<string>;
  /** Канал помечен NSFW. */
  isNsfw?: boolean;
  /** ID пользователей-владельцев. */
  owners?: readonly string[];
}

/** Ошибка гейта: предусловие не прошло или не хватает Capability. */
export class PipelineGateError extends Error {
  constructor(
    message: string,
    readonly kind: 'precondition' | 'capability',
    readonly details?: string,
  ) {
    super(message);
  }
}

interface CooldownEntry {
  until: number;
}

/** Гейт-цепочка: предусловия → run → доставка (capability-проверка — в app/interactor). */
export class Pipeline {
  private readonly cooldowns = new Map<string, CooldownEntry>();

  /** Проверяет предусловия Handler-а. Возвращает outcome; при !ok доставка не происходит. */
  async checkPreconditions(
    handler: Handler,
    ctx: HandlerRunContext,
    env: PreconditionEnv = {},
  ): Promise<PreconditionOutcome> {
    for (const spec of handler.preconditions) {
      const outcome = await this.evaluatePrecondition(spec, ctx, env);
      if (!outcome.ok) return outcome;
    }
    return { ok: true };
  }

  private async evaluatePrecondition(
    spec: PreconditionSpec,
    ctx: HandlerRunContext,
    env: PreconditionEnv,
  ): Promise<PreconditionOutcome> {
    switch (spec.type) {
      case 'guildOnly':
        if (!ctx.input.channel.guildId) return { ok: false, reason: 'Эта команда работает только на сервере' };
        return { ok: true };
      case 'dmOnly':
        if (ctx.input.channel.guildId) return { ok: false, reason: 'Эта команда работает только в личных сообщениях' };
        return { ok: true };
      case 'nsfwOnly':
        if (env.isNsfw === true) return { ok: true };
        return { ok: false, reason: 'Эта команда работает только в NSFW-каналах' };
      case 'ownerOnly':
        if (!env.owners?.includes(ctx.input.author.id)) {
          return { ok: false, reason: 'Только владелец бота может это сделать' };
        }
        return { ok: true };
      case 'permissions': {
        const required = spec.permissions;
        const granted = env.memberPermissions;
        if (!granted) return { ok: false, reason: 'Не удалось проверить права участника' };
        const missing = required.filter((p) => !granted.has(p));
        if (missing.length > 0) {
          return { ok: false, reason: `Недостаточно прав: ${missing.join(', ')}` };
        }
        return { ok: true };
      }
      case 'cooldown': {
        const key = `${ctx.input.commandName}:${ctx.input.author.id}`;
        const now = Date.now();
        const entry = this.cooldowns.get(key);
        if (entry && entry.until > now) {
          const left = Math.ceil((entry.until - now) / 1000);
          return { ok: false, reason: `Подождите ещё ${left} сек.` };
        }
        this.cooldowns.set(key, { until: now + spec.seconds * 1000 });
        return { ok: true };
      }
      case 'custom':
        return spec.check(ctx);
      default:
        return { ok: true };
    }
  }

  /** Выполняет Handler: парсит аргументы и вызывает run. */
  async run<A extends ArgsSchema>(handler: Handler<A>, ctx: HandlerRunContext): Promise<Result> {
    const args = parseArgs(handler.args, ctx.input.args);
    return handler.run({ ...ctx, args });
  }

  /** Список Capability-ей, которых не хватает Bot-у в канале. */
  missingCapabilities(handler: Handler, granted: ReadonlySet<Capability>): Capability[] {
    return handler.capabilities.filter((c) => !granted.has(c));
  }

  clearCooldowns(): void {
    this.cooldowns.clear();
  }
}

export function capabilityLabel(capability: Capability): string {
  const labels: Record<Capability, string> = {
    SendMessages: 'право отправлять сообщения',
    EmbedLinks: 'право Embed Links',
    AttachFiles: 'право Attach Files',
    AddReactions: 'право Add Reactions',
    ManageMessages: 'право Manage Messages',
    ManageWebhooks: 'право Manage Webhooks',
    UseExternalEmojis: 'право Use External Emojis',
    UseExternalStickers: 'право Use External Stickers',
  };
  return labels[capability];
}
