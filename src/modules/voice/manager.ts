import type { Collection, Database, Logger, Store } from '../../core/index.ts';

/** Тип голосового канала в Discord API (ChannelType.GuildVoice = 2). */
export const CHANNEL_TYPE_GUILD_VOICE = 2;

/** Дефолтный шаблон названия временного канала. */
export const DEFAULT_NAME_TEMPLATE = '🔊 {user}';

/** Конфиг временных каналов для сервера (хранится в store по ключу config:<guildId>). */
export interface VoiceConfig {
  triggerChannelId: string;
  categoryId: string;
  nameTemplate?: string;
}

/** Запись о временном канале в БД (коллекция 'temp_channels'). */
export interface TempChannelRecord {
  channelId: string;
  guildId: string;
  ownerId: string;
  categoryId: string;
  createdAt: number;
}

/** Структурные типы для взаимодействия с Discord (без прямого импорта discord.js). */
export interface MemberLike {
  id: string;
  displayName?: string;
  user?: {
    username?: string;
    id?: string;
  } | null;
  voice?: {
    setChannel?(channel: unknown): Promise<unknown>;
  } | null;
}

export interface ChannelLike {
  id: string;
  name?: string | null;
  parentId?: string | null;
  members?: unknown;
  delete?(reason?: string): Promise<unknown>;
}

export interface GuildLike {
  id: string;
  channels: {
    cache: {
      get(channelId: string): unknown;
    };
    fetch?(channelId: string): Promise<unknown>;
    create?(options: {
      name: string;
      type: number;
      parent?: string;
    }): Promise<unknown>;
  };
}

export interface ClientLike {
  guilds: {
    cache: {
      get(guildId: string): unknown;
    };
  };
}

export interface VoiceStateLike {
  guild?: GuildLike | null;
  channelId?: string | null;
  member?: MemberLike | null;
}

export interface VoiceManagerDeps {
  client: ClientLike;
  db: Database;
  store: Store;
  logger: Logger;
}

export interface VoiceManager {
  recover(): Promise<{ deleted: number; preserved: number }>;
  handleVoiceState(oldState: VoiceStateLike, newState: VoiceStateLike): Promise<void>;
  handleChannelDelete(channelId: string): Promise<void>;
  cleanupGuild(guildId: string): Promise<number>;
  dispose(): void;
}

export const configKey = (guildId: string) => `config:${guildId}`;

/** Разбирает упоминание канала (<#123>) или голый числовой ID; иначе null. */
export function parseChannelMention(raw: string): string | null {
  const trimmed = raw.trim();
  const mention = /^<#(\d+)>$/.exec(trimmed);
  if (mention) return mention[1]!;
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

/** Форматирует название временного канала по шаблону (макс 100 символов в Discord). */
export function formatChannelName(template: string | undefined, username: string): string {
  const baseTemplate = template && template.trim().length > 0 ? template.trim() : DEFAULT_NAME_TEMPLATE;
  const cleanUsername = username.trim() || 'Участник';
  const formatted = baseTemplate.replace(/\{user\}/gi, cleanUsername).trim();
  const clamped = formatted.slice(0, 100).trim();
  return clamped.length > 0 ? clamped : '🔊 Временная комната';
}

/** Безопасное приведение к ChannelLike */
export function asChannelLike(obj: unknown): ChannelLike | null {
  if (obj && typeof obj === 'object' && 'id' in obj && typeof (obj as { id: unknown }).id === 'string') {
    return obj as ChannelLike;
  }
  return null;
}

/** Безопасное приведение к GuildLike */
export function asGuildLike(obj: unknown): GuildLike | null {
  if (obj && typeof obj === 'object' && 'id' in obj && typeof (obj as { id: unknown }).id === 'string' && 'channels' in obj) {
    return obj as GuildLike;
  }
  return null;
}

/** Получение количества участников в канале */
export function channelMembersCount(channel: ChannelLike): number {
  if (!channel.members || typeof channel.members !== 'object') return 0;
  if ('size' in channel.members && typeof channel.members.size === 'number') {
    return channel.members.size;
  }
  return 0;
}

/** Безопасное получение канала (сначала кэш, затем fetch с перехватом ошибок). */
async function fetchChannelSafe(guild: GuildLike, channelId: string): Promise<ChannelLike | null> {
  const cached = guild.channels.cache.get(channelId);
  if (cached) return asChannelLike(cached);
  if (typeof guild.channels.fetch === 'function') {
    try {
      const fetched = await guild.channels.fetch(channelId);
      return asChannelLike(fetched);
    } catch {
      return null;
    }
  }
  return null;
}

export function createVoiceManager({ client, db, store, logger }: VoiceManagerDeps): VoiceManager {
  const channelsCol: Collection<TempChannelRecord> = db.collection<TempChannelRecord>('temp_channels');
  const inFlightCreations = new Set<string>();
  const inFlightDeletions = new Set<string>();

  return {
    async recover() {
      let deleted = 0;
      let preserved = 0;
      try {
        const records = await channelsCol.find();
        for (const record of records) {
          const guild = asGuildLike(client.guilds.cache.get(record.guildId));
          if (!guild) {
            await channelsCol.delete({ channelId: record.channelId });
            deleted++;
            continue;
          }
          const channel = await fetchChannelSafe(guild, record.channelId);
          if (!channel) {
            await channelsCol.delete({ channelId: record.channelId });
            deleted++;
            continue;
          }
          if (channelMembersCount(channel) === 0) {
            if (typeof channel.delete === 'function') {
              try {
                await channel.delete('Временный канал пуст после перезапуска');
              } catch (err) {
                logger.warn('voice: не удалось удалить пустой канал при восстановлении', {
                  channelId: record.channelId,
                  error: err,
                });
              }
            }
            await channelsCol.delete({ channelId: record.channelId });
            deleted++;
          } else {
            preserved++;
          }
        }
        logger.info('voice: восстановление временных каналов завершено', { deleted, preserved });
      } catch (err) {
        logger.error('voice: ошибка восстановления временных каналов', { error: err });
      }
      return { deleted, preserved };
    },

    async handleVoiceState(oldState: VoiceStateLike, newState: VoiceStateLike) {
      const guild = asGuildLike(newState.guild ?? oldState.guild);
      if (!guild) return;
      const guildId = guild.id;

      // 1. Выход или переход из временного канала -> если опустел, удаляем
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const oldChannelId = oldState.channelId;
        if (!inFlightDeletions.has(oldChannelId)) {
          const record = await channelsCol.findOne({ channelId: oldChannelId });
          if (record) {
            const channel = await fetchChannelSafe(guild, oldChannelId);
            if (!channel) {
              await channelsCol.delete({ channelId: oldChannelId });
            } else if (channelMembersCount(channel) === 0) {
              inFlightDeletions.add(oldChannelId);
              try {
                if (typeof channel.delete === 'function') {
                  await channel.delete('Временный канал опустел');
                }
                await channelsCol.delete({ channelId: oldChannelId });
                logger.info('voice: удалён временный канал', { channelId: oldChannelId, guildId });
              } catch (err) {
                logger.warn('voice: ошибка удаления временного канала', { channelId: oldChannelId, error: err });
              } finally {
                inFlightDeletions.delete(oldChannelId);
              }
            }
          }
        }
      }

      // 2. Вход в триггер-канал -> создаём временный канал в категории и переносим пользователя
      if (newState.channelId && oldState.channelId !== newState.channelId) {
        const config = await store.get<VoiceConfig>(configKey(guildId));
        if (config && newState.channelId === config.triggerChannelId) {
          const member = newState.member;
          if (!member) return;

          if (inFlightCreations.has(member.id)) return;
          inFlightCreations.add(member.id);

          try {
            if (typeof guild.channels.create !== 'function') {
              logger.warn('voice: guild.channels.create недоступен');
              return;
            }

            const username = member.displayName || member.user?.username || 'Участник';
            const channelName = formatChannelName(config.nameTemplate, username);

            const createdRaw = await guild.channels.create({
              name: channelName,
              type: CHANNEL_TYPE_GUILD_VOICE,
              parent: config.categoryId,
            });

            const created = asChannelLike(createdRaw);
            if (!created) {
              logger.warn('voice: созданный канал не имеет структуры ChannelLike');
              return;
            }

            await channelsCol.insert({
              channelId: created.id,
              guildId,
              ownerId: member.id,
              categoryId: config.categoryId,
              createdAt: Date.now(),
            });

            try {
              if (typeof member.voice?.setChannel === 'function') {
                await member.voice.setChannel(created);
              }
            } catch (err) {
              logger.warn('voice: не удалось перенести участника в созданный канал', {
                channelId: created.id,
                memberId: member.id,
                error: err,
              });
              if (channelMembersCount(created) === 0) {
                if (typeof created.delete === 'function') {
                  try {
                    await created.delete('Участник не перешёл в созданный канал');
                  } catch {
                    // ignore
                  }
                }
                await channelsCol.delete({ channelId: created.id });
              }
            }
          } catch (err) {
            logger.error('voice: ошибка создания временного канала', {
              guildId,
              memberId: member.id,
              error: err,
            });
          } finally {
            inFlightCreations.delete(member.id);
          }
        }
      }
    },

    async handleChannelDelete(channelId: string) {
      try {
        await channelsCol.delete({ channelId });
      } catch (err) {
        logger.warn('voice: ошибка при очистке удалённого канала из БД', { channelId, error: err });
      }
    },

    async cleanupGuild(guildId: string) {
      let cleaned = 0;
      try {
        const records = await channelsCol.find({ guildId });
        const guild = asGuildLike(client.guilds.cache.get(guildId));
        for (const record of records) {
          if (!guild) {
            await channelsCol.delete({ channelId: record.channelId });
            cleaned++;
            continue;
          }
          const channel = await fetchChannelSafe(guild, record.channelId);
          if (!channel) {
            await channelsCol.delete({ channelId: record.channelId });
            cleaned++;
            continue;
          }
          if (channelMembersCount(channel) === 0) {
            if (typeof channel.delete === 'function') {
              try {
                await channel.delete('Ручная очистка');
              } catch {
                // ignore
              }
            }
            await channelsCol.delete({ channelId: record.channelId });
            cleaned++;
          }
        }
      } catch (err) {
        logger.error('voice: ошибка ручной очистки каналов гильдии', { guildId, error: err });
      }
      return cleaned;
    },

    dispose() {
      inFlightCreations.clear();
      inFlightDeletions.clear();
    },
  };
}
