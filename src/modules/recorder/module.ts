import { z } from 'zod';
import { arg, defineHandler, defineModule, type Result } from '../../core/index.ts';
import {
  createRecorder,
  type ClientLike,
  type Recorder,
  type StopOutcome,
  type MemberVoiceChannel,
} from './voice.ts';

/**
 * Запись звука из голосовых каналов.
 *
 * Хэндлеры чистые: они работают с `Recorder`, который создаётся в `onReady(client)`
 * (санкционированный escape-hatch ядра, ADR-0010) — всё общение с Discord Voice
 * изолировано в ./voice.ts. Здесь — только решения: куда подключиться, что ответить.
 */

/** Опции модуля из bot.config.ts (recorder.options). */
const optionsSchema = z.object({
  /** Лимит длительности записи, сек (авто-остановка с доставкой). */
  maxDurationSeconds: z.number().int().positive().max(24 * 60 * 60).default(1800),
  /** Максимум файлов в одном сообщении (лимит вложений Discord — 10). */
  maxFiles: z.number().int().positive().max(10).default(10),
});

/** Дефолтный лимит длительности, сек — используется в подсказке /help. */
export const MAX_DURATION_SECONDS = 30 * 60;

/** Разбирает упоминание канала (<#123>) или голый ID; иначе null. */
export function parseChannelMention(raw: string): string | null {
  const trimmed = raw.trim();
  const mention = /^<#(\d+)>$/.exec(trimmed);
  if (mention) return mention[1]!;
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

/**
 * Куда записывать: явный аргумент (#канал/ID) или голосовой канал, где сидит
 * автор команды (из карты голосовых состояний, которую ведёт Recorder).
 */
export function resolveTargetChannel(params: {
  guildId?: string;
  channel?: string | undefined;
  memberChannel?: MemberVoiceChannel | undefined;
}): { guildId: string; channelId: string } | null {
  const { guildId, channel, memberChannel } = params;
  if (!guildId) return null;
  if (channel) {
    const channelId = parseChannelMention(channel);
    if (!channelId) return null;
    return { guildId, channelId };
  }
  if (!memberChannel || memberChannel.guildId !== guildId) return null;
  return { guildId, channelId: memberChannel.channelId };
}

/** Русская плюрализация: pluralize(5, ['файл', 'файла', 'файлов']). */
export function pluralize(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100;
  const n10 = n % 10;
  if (n > 10 && n < 20) return forms[2]!;
  if (n10 > 1 && n10 < 5) return forms[1]!;
  if (n10 === 1) return forms[0]!;
  return forms[2]!;
}

/** Человекочитаемая длительность: «5 мин 12 сек». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${pluralize(h, ['час', 'часа', 'часов'])}`);
  if (m > 0) parts.push(`${m} ${pluralize(m, ['минута', 'минуты', 'минут'])}`);
  if (s > 0 || parts.length === 0) parts.push(`${s} ${pluralize(s, ['секунда', 'секунды', 'секунд'])}`);
  return parts.join(' ');
}

/** Result с файлами записи (или сообщение «никто не говорил»). */
export function buildStopResult(outcome: StopOutcome & { ok: true }): Result {
  if (outcome.files.length === 0) {
    return {
      kind: 'message',
      content: `🔇 Никто не говорил за ${formatDuration(outcome.durationMs)} — файлов нет`,
    };
  }
  const results: Result[] = [
    {
      kind: 'message',
      content: `✅ Запись готова: ${outcome.files.length} ${pluralize(outcome.files.length, ['файл', 'файла', 'файлов'])} (${formatDuration(outcome.durationMs)})`,
    },
    ...outcome.files.map((f) => ({
      kind: 'attachment' as const,
      file: { name: f.name, data: f.data },
    })),
  ];
  if (outcome.truncated) {
    results.push({
      kind: 'message',
      content: `⚠️ Говорили ${outcome.speakers}, показаны первые ${outcome.files.length} (лимит вложений Discord)`,
    });
  }
  return { kind: 'multiple', results };
}

// ===== runtime-состояние (устанавливается в onReady) =====

let voice: Recorder | undefined;

/** Тестовый хук: подмена Recorder (в проде создаётся в onReady). */
export function setRecorderForTest(recorder: Recorder | undefined): void {
  voice = recorder;
}

const notReady = (): Result => ({
  kind: 'message',
  content: 'Запись недоступна: бот ещё не подключён к Discord',
  ephemeral: true,
});

export default defineModule({
  name: 'recorder',
  description: 'Запись звука из голосовых каналов в WAV (16 кГц, моно)',
  optionsSchema,
  handlers: [
    defineHandler({
      name: 'record',
      description: 'Начать запись голосового канала: /record #канал (или без аргумента — ваш канал)',
      args: {
        channel: arg.string('голосовой канал: #канал или ID').optional(),
      },
      preconditions: [{ type: 'guildOnly' }],
      run: async ({ args, input }) => {
        const guildId = input.channel.guildId;
        if (!guildId) return { kind: 'message', content: 'Только на сервере', ephemeral: true };
        if (!voice) return notReady();

        const target = resolveTargetChannel({
          guildId,
          channel: args.channel,
          memberChannel: voice.memberChannelOf(input.author.id),
        });
        if (!target) {
          return {
            kind: 'message',
            content: 'Вы не в голосовом канале — укажите канал: /record #канал',
            ephemeral: true,
          };
        }

        const outcome = await voice.start(guildId, target.channelId, input.channel.id, input.author.username);
        if (!outcome.ok) return { kind: 'message', content: outcome.error, ephemeral: true };
        return {
          kind: 'message',
          content: `🎙 Записываю <#${target.channelId}>. Остановить и получить файлы: /record-stop`,
        };
      },
    }),
    defineHandler({
      name: 'record-stop',
      description: 'Остановить запись и получить файлы говорящих (WAV, 16 кГц)',
      preconditions: [{ type: 'guildOnly' }],
      capabilities: ['SendMessages', 'AttachFiles'],
      run: ({ input }) => {
        const guildId = input.channel.guildId;
        if (!guildId) return { kind: 'message', content: 'Только на сервере', ephemeral: true };
        if (!voice) return notReady();
        const outcome = voice.stop(guildId);
        if (!outcome.ok) return { kind: 'message', content: outcome.error, ephemeral: true };
        return buildStopResult(outcome);
      },
    }),
    defineHandler({
      name: 'record-status',
      description: 'Статус текущей записи',
      preconditions: [{ type: 'guildOnly' }],
      run: ({ input }) => {
        const guildId = input.channel.guildId;
        if (!guildId) return { kind: 'message', content: 'Только на сервере', ephemeral: true };
        if (!voice) return notReady();
        const status = voice.status(guildId);
        if (!status) {
          return { kind: 'message', content: 'Сейчас нет активной записи', ephemeral: true };
        }
        return {
          kind: 'message',
          content: `🎙 Идёт запись <#${status.channelId}>… ${formatDuration(Date.now() - status.startedAt)}, участников: ${status.speakers}. Остановить: /record-stop`,
        };
      },
    }),
  ],
  onReady: ({ client, logger, options }) => {
    const recorder = createRecorder(client, logger, {
      maxDurationMs: options.maxDurationSeconds * 1000,
      maxFiles: options.maxFiles,
    });
    recorder.onAutoStop = (info) => {
      void deliverAutoStop(client, info, logger);
    };
    client.on('voiceStateUpdate', (oldState, newState) => {
      recorder.handleVoiceState(
        newState.id,
        newState.guild.id,
        newState.channelId,
        newState.id === client.user?.id,
        newState.member?.user?.username ?? undefined,
      );
    });
    voice = recorder;
  },
  onShutdown: () => {
    voice?.dispose();
    voice = undefined;
  },
});

/** Доставка авто-остановленной записи в текстовый канал, откуда её запустили. */
export async function deliverAutoStop(
  client: ClientLike,
  info: { textChannelId: string; reason: string; outcome: StopOutcome },
  logger: { warn(message: string, meta?: Record<string, unknown>): void; error(message: string, error?: unknown): void },
): Promise<void> {
  const channel = client.channels.cache.get(info.textChannelId);
  if (!channel || !channel.isSendable || !channel.send) {
    logger.warn('recorder: канал для доставки записи недоступен', { channelId: info.textChannelId });
    return;
  }
  if (!info.outcome.ok) return;
  const files = info.outcome.files.map((f) => ({ name: f.name, attachment: Buffer.from(f.data) }));
  const summary =
    info.outcome.files.length === 0
      ? `🔇 ${info.reason} — никто не говорил`
      : `⏹ ${info.reason}. Запись готова: ${info.outcome.files.length} файлов (${formatDuration(info.outcome.durationMs)})`;
  try {
    await channel.send({ content: summary, files });
  } catch (err) {
    logger.error('recorder: не удалось доставить запись', err);
  }
}
