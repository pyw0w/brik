import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonStyle as DiscordButtonStyle,
  type ChatInputCommandInteraction,
  type EmbedData,
  type Interaction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type MessageComponentInteraction,
  type PermissionResolvable,
} from 'discord.js';
import type { PreconditionEnv } from '../internal/pipeline.ts';
import type {
  ButtonStyle as CoreButtonStyle,
  Capability,
  Input,
  Logger,
  Result,
} from '../types.ts';

/** Окружение, извлечённое из Discord-взаимодействия для гейт-цепочки. */
export interface InteractionEnv {
  preconditions: PreconditionEnv;
  granted: ReadonlySet<Capability>;
}

/** Нажатие кнопки в терминах ядра (без деталей Discord API). */
export interface ComponentClick {
  customId: string;
  author: { id: string; username: string };
  channel: { id: string; guildId?: string };
}

/** Порт входа для оркестратора (реализуется src/app/interactor.ts). */
export interface InteractionHandler {
  handle(input: Input, env: InteractionEnv): Promise<Result | undefined>;
  handleComponent(click: ComponentClick, env: InteractionEnv): Promise<Result | undefined>;
}

/** Переводит ChatInputCommandInteraction → Input (без деталей Discord). */
export function toInput(interaction: ChatInputCommandInteraction): Input {
  const args: Record<string, unknown> = {};
  for (const option of interaction.options.data) {
    if (option.value !== undefined) args[option.name] = option.value;
  }
  return {
    commandName: interaction.commandName,
    args,
    author: { id: interaction.user.id, username: interaction.user.username },
    channel: {
      id: interaction.channelId,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    },
  };
}

/** Извлекает окружение предусловий (права участника, NSFW, владельцы). */
export function resolvePreconditionEnv(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  owners: string[],
): PreconditionEnv {
  const permissions = new Set<string>();
  if (interaction.memberPermissions) {
    for (const [key] of Object.entries(PermissionFlagsBits)) {
      if (interaction.memberPermissions.has(key as PermissionResolvable)) permissions.add(key);
    }
  }
  let isNsfw = false;
  if (interaction.channel && interaction.channel.type === ChannelType.GuildText) {
    isNsfw = interaction.channel.nsfw;
  }
  return { memberPermissions: permissions, isNsfw, owners };
}

/** Права, реально доступные Bot-у в канале этого взаимодействия. */
export function resolveGrantedCapabilities(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
): Set<Capability> {
  const granted = new Set<Capability>();
  if (!interaction.guild) {
    granted.add('SendMessages');
    granted.add('EmbedLinks');
    granted.add('AttachFiles');
    granted.add('AddReactions');
    return granted;
  }
  const me = interaction.guild.members.me;
  if (!me) return granted;
  const channel = interaction.channel;
  if (channel && 'permissionsFor' in channel) {
    const perms = channel.permissionsFor(me);
    for (const c of Object.keys(PermissionFlagsBits) as Capability[]) {
      if (c in PermissionFlagsBits && perms?.has(c as PermissionResolvable)) granted.add(c);
    }
  }
  return granted;
}

/** Маппинг стиля кнопки из контракта на discord.js ButtonStyle. */
const BUTTON_STYLES: Record<CoreButtonStyle, DiscordButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

function toButtonRow(row: import('../types.ts').ComponentRow): ActionRowBuilder<ButtonBuilder> {
  const builder = new ActionRowBuilder<ButtonBuilder>();
  for (const b of row.buttons) {
    const button = new ButtonBuilder()
      .setStyle(BUTTON_STYLES[b.style ?? 'secondary'])
      .setLabel(b.label);
    if (b.url) button.setURL(b.url);
    else if (b.id) button.setCustomId(b.id);
    if (b.emoji) button.setEmoji(b.emoji);
    if (b.disabled) button.setDisabled(true);
    builder.addComponents(button);
  }
  return builder;
}

/** Переводит Result → payload для reply/followUp. */
export function resultToPayload(result: Result): InteractionReplyOptions {
  switch (result.kind) {
    case 'message':
      return {
        content: result.content,
        ...(result.ephemeral ? { ephemeral: true } : {}),
      };
    case 'embed':
      return {
        embeds: [toApiEmbed(result.embed)],
        ...(result.ephemeral ? { ephemeral: true } : {}),
      };
    case 'attachment':
      return {
        ...(result.caption ? { content: result.caption } : {}),
        files: [{ name: result.file.name, attachment: Buffer.from(result.file.data) }],
        ...(result.ephemeral ? { ephemeral: true } : {}),
      };
    case 'component':
      return {
        ...(result.content ? { content: result.content } : {}),
        components: result.rows.map(toButtonRow),
        ...(result.ephemeral ? { ephemeral: true } : {}),
      };
    case 'multiple': {
      const messages = result.results.filter((r) => r.kind === 'message') as Extract<Result, { kind: 'message' }>[];
      const embeds = result.results.filter((r) => r.kind === 'embed') as Extract<Result, { kind: 'embed' }>[];
      const files = result.results
        .filter((r) => r.kind === 'attachment') as Extract<Result, { kind: 'attachment' }>[];
      const rows = result.results
        .filter((r) => r.kind === 'component') as Extract<Result, { kind: 'component' }>[];
      return {
        ...(messages.length > 0 ? { content: messages.map((m) => m.content).join('\n') } : {}),
        ...(embeds.length > 0 ? { embeds: embeds.map((e) => toApiEmbed(e.embed)) } : {}),
        ...(files.length > 0
          ? { files: files.map((f) => ({ name: f.file.name, attachment: Buffer.from(f.file.data) })) }
          : {}),
        ...(rows.length > 0 ? { components: rows.flatMap((r) => r.rows).map(toButtonRow) } : {}),
        ...(result.results.some((r) => 'ephemeral' in r && r.ephemeral) ? { ephemeral: true } : {}),
      };
    }
    case 'update':
      // update — режим доставки (перезапись сообщения), внутри payload не существует.
      throw new Error('Result kind=update обрабатывается в sendResult, не в resultToPayload');
  }
}

/** Нормализует EmbedData до APIEmbed (timestamp, поля). */
export function toApiEmbed(embed: EmbedData): ReturnType<EmbedBuilder['toJSON']> {
  return new EmbedBuilder(embed).toJSON();
}

/** Доставляет Result в канал: reply, followUp (если уже ответили/отложили) или update (перезапись кнопок). */
export async function sendResult(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  result: Result,
): Promise<void> {
  if (result.kind === 'update') {
    if (interaction.isMessageComponent()) {
      const payload = resultToPayload(result.result) as unknown as InteractionUpdateOptions;
      if ('ephemeral' in payload) delete payload.ephemeral; // update() не принимает ephemeral
      await interaction.update(payload).catch(() => undefined);
      return;
    }
    // update из slash-команды невозможен — деградируем до обычного ответа.
    result = result.result;
  }

  const payload = resultToPayload(result);
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => undefined);
  } else {
    await interaction.reply(payload).catch(() =>
      interaction.followUp(payload).catch(() => undefined),
    );
  }
}

/** Тонкий слушатель interactionCreate: type-guard → translate → interact → present. */
export async function dispatchInteraction(
  interaction: Interaction,
  deps: { handler: InteractionHandler; owners: string[]; logger: Logger },
): Promise<void> {
  try {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const env: InteractionEnv = {
      preconditions: resolvePreconditionEnv(interaction, deps.owners),
      granted: resolveGrantedCapabilities(interaction),
    };

    const result = interaction.isChatInputCommand()
      ? await deps.handler.handle(toInput(interaction), env)
      : await deps.handler.handleComponent(
          {
            customId: interaction.customId,
            author: { id: interaction.user.id, username: interaction.user.username },
            channel: {
              id: interaction.channelId,
              ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
            },
          },
          env,
        );

    if (result !== undefined) await sendResult(interaction, result);
  } catch (err) {
    deps.logger.error('Ошибка обработки взаимодействия', err);
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    await sendResult(interaction, {
      kind: 'message',
      content: 'Произошла ошибка при выполнении команды.',
      ephemeral: true,
    }).catch(() => undefined);
  }
}
