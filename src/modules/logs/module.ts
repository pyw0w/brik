import { arg, defineHandler, defineModule } from '../../core/index.ts';

/**
 * Система логов. Решающая логика (какие события логировать и какие эмбеды строить) —
 * чистые функции ниже (экспортированы для тестов). Подписки на gateway-события живут
 * в onReady(client) — санкционированный escape-hatch ядра; discord.js не импортируется:
 * типы текут через ctx.client, эмбеды — plain-объекты (структурно совместимы с APIEmbed).
 *
 * Каналы настраиваются на сервере через /logs (право ManageGuild) и хранятся
 * в персистентном store модуля по ключу config:<guildId>.
 */

export type LogType = 'mod' | 'members' | 'messages' | 'voice' | 'punishments';

export interface LogConfig {
  mod?: string;
  members?: string;
  messages?: string;
  voice?: string;
  punishments?: string;
}

export interface LogField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Plain-эмбед (структурно совместим с APIEmbed discord.js). */
export interface LogEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: LogField[];
  timestamp?: string;
}

/** Готовое событие для доставки: тип лога + эмбеды. */
export interface LogEvent {
  type: LogType;
  embeds: LogEmbed[];
}

export const LOG_TYPES: readonly LogType[] = ['mod', 'members', 'messages', 'voice', 'punishments'];

const COLOR = {
  green: 0x57f287,
  red: 0xed4245,
  yellow: 0xfee75c,
  blurple: 0x5865f2,
  orange: 0xfaa61a,
} as const;

const configKey = (guildId: string): string => `config:${guildId}`;

const now = (): string => new Date().toISOString();

/** Экранирует разметку Discord в пользовательском тексте. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`>~|])/g, '\\$1');
}

/** Разбирает упоминание канала (<#123>) или голый ID; иначе null. */
export function parseChannelMention(raw: string): string | null {
  const trimmed = raw.trim();
  const mention = /^<#(\d+)>$/.exec(trimmed);
  if (mention) return mention[1]!;
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

export function resolveConfigType(type: string): LogType | null {
  return (LOG_TYPES as readonly string[]).includes(type) ? (type as LogType) : null;
}

const contentSnippet = (text: string, max = 200): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export interface UserLike {
  id: string;
  username?: string | null;
}

const userLabel = (user?: UserLike | null): string =>
  user ? `**${escapeMarkdown(user.username ?? user.id)}** \`${user.id}\`` : 'неизвестный участник';

// ===== билдеры эмбедов (чистые) =====

export const buildMemberJoined = (user?: UserLike | null): LogEmbed => ({
  title: '👋 Участник вошёл',
  description: userLabel(user),
  color: COLOR.green,
  ...(user ? { fields: [{ name: 'Участник', value: `<@${user.id}>`, inline: true }] } : {}),
  timestamp: now(),
});

export const buildMemberLeft = (user?: UserLike | null): LogEmbed => ({
  title: '🚪 Участник вышел',
  description: userLabel(user),
  color: COLOR.red,
  ...(user ? { fields: [{ name: 'Участник', value: `<@${user.id}>`, inline: true }] } : {}),
  timestamp: now(),
});

export const buildMessageDeleted = (info: {
  author?: UserLike | null | undefined;
  content?: string | null | undefined;
  channelName?: string | undefined;
}): LogEmbed => ({
  title: '🗑️ Сообщение удалено',
  description: userLabel(info.author),
  color: COLOR.red,
  fields: [
    { name: 'Канал', value: info.channelName ?? '—', inline: true },
    ...(info.content ? [{ name: 'Содержимое', value: contentSnippet(info.content) }] : []),
  ],
  timestamp: now(),
});

export const buildMessagesBulkDeleted = (info: {
  count: number;
  channelName?: string | undefined;
}): LogEmbed => ({
  title: '🧹 Массовое удаление',
  description: `**${info.count}** сообщений в канале ${info.channelName ?? '—'}`,
  color: COLOR.red,
  timestamp: now(),
});

export const buildMessageEdited = (info: {
  author?: UserLike | null | undefined;
  oldContent?: string | null | undefined;
  newContent?: string | null | undefined;
  channelName?: string | undefined;
}): LogEmbed => ({
  title: '✏️ Сообщение изменено',
  description: userLabel(info.author),
  color: COLOR.yellow,
  fields: [
    { name: 'Канал', value: info.channelName ?? '—', inline: true },
    ...(info.oldContent ? [{ name: 'Было', value: contentSnippet(info.oldContent) }] : []),
    ...(info.newContent ? [{ name: 'Стало', value: contentSnippet(info.newContent) }] : []),
  ],
  timestamp: now(),
});

export const buildVoiceJoined = (info: {
  user?: UserLike | null | undefined;
  channelName?: string | undefined;
}): LogEmbed => ({
  title: '🔊 Вошёл в голосовой канал',
  description: userLabel(info.user),
  color: COLOR.blurple,
  fields: [{ name: 'Канал', value: info.channelName ?? '—', inline: true }],
  timestamp: now(),
});

export const buildVoiceLeft = (info: {
  user?: UserLike | null | undefined;
  channelName?: string | undefined;
}): LogEmbed => ({
  title: '🔇 Вышел из голосового канала',
  description: userLabel(info.user),
  color: COLOR.blurple,
  fields: [{ name: 'Канал', value: info.channelName ?? '—', inline: true }],
  timestamp: now(),
});

export const buildVoiceMoved = (info: {
  user?: UserLike | null | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): LogEmbed => ({
  title: '🔀 Перемещён в голосовом канале',
  description: userLabel(info.user),
  color: COLOR.blurple,
  fields: [
    { name: 'Из', value: info.from ?? '—', inline: true },
    { name: 'В', value: info.to ?? '—', inline: true },
  ],
  timestamp: now(),
});

export const buildNickChanged = (info: {
  user?: UserLike | null | undefined;
  old?: string | null | undefined;
  next?: string | null | undefined;
}): LogEmbed => ({
  title: '📝 Изменён ник',
  description: userLabel(info.user),
  color: COLOR.orange,
  fields: [
    { name: 'Было', value: info.old ? escapeMarkdown(info.old) : '—', inline: true },
    { name: 'Стало', value: info.next ? escapeMarkdown(info.next) : '—', inline: true },
  ],
  timestamp: now(),
});

export const buildRolesChanged = (info: {
  user?: UserLike | null | undefined;
  added: string[];
  removed: string[];
}): LogEmbed => ({
  title: '🎭 Изменены роли',
  description: userLabel(info.user),
  color: COLOR.orange,
  fields: [
    ...(info.added.length > 0 ? [{ name: 'Добавлено', value: info.added.map(escapeMarkdown).join(', ') }] : []),
    ...(info.removed.length > 0 ? [{ name: 'Убрано', value: info.removed.map(escapeMarkdown).join(', ') }] : []),
  ],
  timestamp: now(),
});

export const buildTimeoutSet = (info: {
  user?: UserLike | null | undefined;
  until: Date;
}): LogEmbed => ({
  title: '⛔ Тайм-аут (мут)',
  description: userLabel(info.user),
  color: COLOR.red,
  fields: [{ name: 'До', value: `<t:${Math.floor(info.until.getTime() / 1000)}:F>`, inline: true }],
  timestamp: now(),
});

export const buildTimeoutCleared = (info: { user?: UserLike | null | undefined }): LogEmbed => ({
  title: '✅ Тайм-аут снят',
  description: userLabel(info.user),
  color: COLOR.green,
  timestamp: now(),
});

export const buildMemberBanned = (info: {
  user?: UserLike | null | undefined;
  reason?: string | null | undefined;
}): LogEmbed => ({
  title: '⛔ Пользователь забанен',
  description: userLabel(info.user),
  color: COLOR.red,
  fields: [{ name: 'Причина', value: info.reason ? escapeMarkdown(info.reason) : 'не указана' }],
  timestamp: now(),
});

export const buildMemberUnbanned = (info: { user?: UserLike | null | undefined }): LogEmbed => ({
  title: '♻️ Разбан',
  description: userLabel(info.user),
  color: COLOR.green,
  timestamp: now(),
});

// ===== решающая логика (чистая, тестируемая) =====

export interface MessageLike {
  author?: UserLike | null | undefined;
  content?: string | null | undefined;
  isBot?: boolean | undefined;
  channelName?: string | undefined;
}

/** Изменение сообщения: null — не текстовое изменение (пропустить). */
export function decideMessageUpdate(
  oldMessage: Pick<MessageLike, 'content'> | null,
  newMessage: MessageLike,
): LogEvent | null {
  if (newMessage.isBot) return null;
  const oldContent = oldMessage?.content;
  const newContent = newMessage.content;
  if (oldContent !== undefined && oldContent === newContent) return null;
  return {
    type: 'messages',
    embeds: [
      buildMessageEdited({
        author: newMessage.author,
        oldContent: oldContent ?? null,
        newContent: newContent ?? null,
        channelName: newMessage.channelName,
      }),
    ],
  };
}

/** Удаление сообщения: null — вне гильдии (DM и т.п.). */
export function decideMessageDelete(
  message: {
    author?: UserLike | null | undefined;
    content?: string | null | undefined;
    channelName?: string | undefined;
    guildId?: string | null | undefined;
  },
): LogEvent | null {
  if (!message.guildId) return null;
  return {
    type: 'messages',
    embeds: [
      buildMessageDeleted({
        author: message.author,
        content: message.content ?? null,
        channelName: message.channelName,
      }),
    ],
  };
}

export type VoiceChange =
  | { kind: 'joined'; channelId: string; channelName?: string }
  | { kind: 'left'; channelId: string; channelName?: string }
  | { kind: 'moved'; fromId: string; toId: string; from?: string; to?: string };

/** Переход голосового состояния: null — без изменений канала. */
export function voiceChange(
  oldState: { channelId?: string | null },
  newState: { channelId?: string | null },
): VoiceChange | null {
  const from = oldState.channelId ?? null;
  const to = newState.channelId ?? null;
  if (!from && to) return { kind: 'joined', channelId: to };
  if (from && !to) return { kind: 'left', channelId: from };
  if (from && to && from !== to) return { kind: 'moved', fromId: from, toId: to };
  return null;
}

export interface MemberLike {
  nickname?: string | null;
  timeoutUntil?: Date | null;
  roleNames: readonly string[];
}

/**
 * Изменение участника: тайм-аут → наказания; ник/роли → мод-логи.
 * Приоритет: тайм-аут, потом ник, потом роли. Null — ничего не менялось.
 */
export function memberChange(
  user: UserLike | null,
  oldMember: MemberLike | null,
  newMember: MemberLike,
): LogEvent | null {
  const oldUntil = oldMember?.timeoutUntil?.getTime() ?? null;
  const newUntil = newMember.timeoutUntil?.getTime() ?? null;
  if (oldUntil !== newUntil) {
    if (newMember.timeoutUntil) {
      return { type: 'punishments', embeds: [buildTimeoutSet({ user, until: newMember.timeoutUntil })] };
    }
    return { type: 'punishments', embeds: [buildTimeoutCleared({ user })] };
  }

  if (oldMember?.nickname !== newMember.nickname) {
    return {
      type: 'mod',
      embeds: [buildNickChanged({ user, old: oldMember?.nickname ?? null, next: newMember.nickname ?? null })],
    };
  }

  const oldRoles = oldMember?.roleNames ?? [];
  const newRoles = newMember.roleNames;
  if (oldRoles.length !== newRoles.length) {
    const added = newRoles.filter((r) => !oldRoles.includes(r));
    const removed = oldRoles.filter((r) => !newRoles.includes(r));
    if (added.length > 0 || removed.length > 0) {
      return { type: 'mod', embeds: [buildRolesChanged({ user, added, removed })] };
    }
  }
  return null;
}

/** Зависимости доставки: как найти канал лога и куда писать предупреждения. */
export interface LogSinkDeps {
  fetchChannel(
    guildId: string,
    type: LogType,
  ): Promise<{ send(payload: { embeds: LogEmbed[] }): Promise<unknown> } | null>;
  warn(message: string, err: unknown): void;
}

/** Доставка события в канал: без события/канала — молча, ошибки — в warn. */
export function createLogSink(deps: LogSinkDeps) {
  return async (guildId: string, event: LogEvent | null): Promise<void> => {
    if (!event) return;
    const channel = await deps.fetchChannel(guildId, event.type);
    if (!channel) return;
    await channel.send({ embeds: event.embeds }).catch((err: unknown) => {
      deps.warn('logs: не удалось доставить', err);
    });
  };
}

/** Имя канала из объекта канала (для названий в эмбедах). */
export function channelNameOf(ch: unknown): string | undefined {
  if (ch && typeof ch === 'object' && 'name' in ch) {
    const name = (ch as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Имя голосового канала по ID из кэша гильдии. */
export function voiceChannelName(
  guild: { channels: { cache: { get(id: string): { name?: string } | undefined } } },
  id: string,
): string | undefined {
  return guild.channels.cache.get(id)?.name;
}

// ===== модуль =====

export default defineModule({
  name: 'logs',
  description: 'Система логов: мод-действия, участники, сообщения, голос, наказания',
  handlers: [
    defineHandler({
      name: 'logs',
      description: 'Настройка каналов логов: /logs set <тип> <канал> | show | clear <тип>',
      args: {
        action: arg.enum('действие: set / show / clear', ['set', 'show', 'clear']).default('show'),
        type: arg.string('тип лога: mod, members, messages, voice, punishments').optional(),
        channel: arg.string('канал: #канал или ID').optional(),
      },
      preconditions: [
        { type: 'guildOnly' },
        { type: 'permissions', permissions: ['ManageGuild'] },
      ],
      run: async ({ args, store, input }) => {
        const guildId = input.channel.guildId;
        if (!guildId) {
          return { kind: 'message', content: 'Настройка логов — только на сервере', ephemeral: true };
        }
        const key = configKey(guildId);
        const config = (await store.get<LogConfig>(key)) ?? {};

        if (args.action === 'set') {
          const type = args.type ? resolveConfigType(args.type) : null;
          if (!type) {
            return {
              kind: 'message',
              content: `Неизвестный тип. Доступно: ${LOG_TYPES.join(', ')}`,
              ephemeral: true,
            };
          }
          const channelId = args.channel ? parseChannelMention(args.channel) : null;
          if (!channelId) {
            return {
              kind: 'message',
              content: 'Укажите канал упоминанием (#канал) или его ID',
              ephemeral: true,
            };
          }
          await store.set(key, { ...config, [type]: channelId });
          return { kind: 'message', content: `📝 Лог «${type}» → <#${channelId}>` };
        }

        if (args.action === 'clear') {
          const type = args.type ? resolveConfigType(args.type) : null;
          if (!type) {
            return {
              kind: 'message',
              content: `Неизвестный тип. Доступно: ${LOG_TYPES.join(', ')}`,
              ephemeral: true,
            };
          }
          if (!config[type]) {
            return { kind: 'message', content: `Лог «${type}» и так не настроен`, ephemeral: true };
          }
          const { [type]: _removed, ...rest } = config;
          await store.set(key, rest);
          return { kind: 'message', content: `Лог «${type}» очищен` };
        }

        const lines = LOG_TYPES.map((t) => {
          const id = config[t];
          return id ? `• **${t}** → <#${id}>` : `• **${t}** — не настроен`;
        });
        return { kind: 'message', content: `**Каналы логов:**\n${lines.join('\n')}` };
      },
    }),
  ],
  onReady: async ({ client, store, logger }) => {
    const sink = createLogSink({
      fetchChannel: async (guildId, type) => {
        const config = await store.get<LogConfig>(configKey(guildId));
        const channelId = config?.[type];
        if (!channelId) return null;
        const channel = client.channels.cache.get(channelId);
        return channel && channel.isSendable() ? channel : null;
      },
      warn: (message, err) => logger.warn(message, { error: err }),
    });

    const sendMembers = (guildId: string, embed: LogEmbed) =>
      void sink(guildId, { type: 'members', embeds: [embed] });
    const sendLog = (guildId: string, event: LogEvent | null) => void sink(guildId, event);
    const sendVoice = (guildId: string, embed: LogEmbed) =>
      void sink(guildId, { type: 'voice', embeds: [embed] });
    const sendPunishments = (guildId: string, embed: LogEmbed) =>
      void sink(guildId, { type: 'punishments', embeds: [embed] });

    // 👥 Участники: входы и выходы.
    client.on('guildMemberAdd', (member) => {
      sendMembers(member.guild.id, buildMemberJoined(member.user));
    });
    client.on('guildMemberRemove', (member) => {
      sendMembers(member.guild.id, buildMemberLeft(member.user));
    });

    // 💬 Сообщения: удалённые и изменённые.
    client.on('messageDelete', (message) => {
      sendLog(
        message.guild?.id ?? '',
        decideMessageDelete({
          author: message.author ? { id: message.author.id, username: message.author.username } : null,
          content: message.content ?? null,
          channelName: channelNameOf(message.channel),
          guildId: message.guild?.id ?? null,
        }),
      );
    });
    client.on('messageDeleteBulk', (messages, channel) => {
      if (!channel.guildId) return;
      sendLog(channel.guildId, {
        type: 'messages',
        embeds: [buildMessagesBulkDeleted({ count: messages.size, channelName: channel.name })],
      });
    });
    client.on('messageUpdate', (oldMessage, newMessage) => {
      const guildId = newMessage.guild?.id;
      if (!guildId) return;
      sendLog(guildId, decideMessageUpdate(oldMessage, {
        author: newMessage.author ? { id: newMessage.author.id, username: newMessage.author.username } : null,
        content: newMessage.content,
        isBot: newMessage.author?.bot ?? false,
        channelName: channelNameOf(newMessage.channel),
      }));
    });

    // 🔊 Голос: вход, выход, перемещение.
    client.on('voiceStateUpdate', (oldState, newState) => {
      const guildId = newState.guild.id;
      const change = voiceChange(oldState, newState);
      if (!change) return;
      const user = newState.member?.user ?? oldState.member?.user ?? null;
      if (change.kind === 'joined') {
        sendVoice(guildId, buildVoiceJoined({ user, channelName: voiceChannelName(newState.guild, change.channelId) }));
      } else if (change.kind === 'left') {
        sendVoice(guildId, buildVoiceLeft({ user, channelName: voiceChannelName(newState.guild, change.channelId) }));
      } else {
        sendVoice(guildId, buildVoiceMoved({
          user,
          from: voiceChannelName(newState.guild, change.fromId),
          to: voiceChannelName(newState.guild, change.toId),
        }));
      }
    });

    // 📝 Мод + ⛔ наказания: изменения участника (ник, роли, тайм-аут).
    client.on('guildMemberUpdate', (oldMember, newMember) => {
      sendLog(
        newMember.guild.id,
        memberChange(
          newMember.user,
          oldMember
            ? {
                nickname: oldMember.nickname,
                timeoutUntil: oldMember.communicationDisabledUntil,
                roleNames: oldMember.roles.cache.map((r) => r.name),
              }
            : null,
          {
            nickname: newMember.nickname,
            timeoutUntil: newMember.communicationDisabledUntil,
            roleNames: newMember.roles.cache.map((r) => r.name),
          },
        ),
      );
    });

    // ⛔ Наказания: баны и разбаны.
    client.on('guildBanAdd', (ban) => {
      sendPunishments(ban.guild.id, buildMemberBanned({ user: ban.user, reason: ban.reason }));
    });
    client.on('guildBanRemove', (ban) => {
      sendPunishments(ban.guild.id, buildMemberUnbanned({ user: ban.user }));
    });
  },
});
