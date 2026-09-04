/**
 * Интеграция с @discordjs/voice: подключение к голосовому каналу и запись в WAV.
 *
 * Это единственный файл модуля, который зависит от внешних голосовых библиотек
 * (`@discordjs/voice` + WASM-декодер `opusscript`; нативный `@discordjs/opus` не
 * грузится под bun). Модуль использует это через `createRecorder(client, ...)` в
 * `onReady` — тот же санкционированный escape-hatch, что и подписки на
 * gateway-события (ADR-0010): хэндлеры остаются чистыми, живой `client` живёт
 * только в onReady.
 *
 * Запись — «пассивная»: подписываемся на участников голосового канала через
 * `receiver.subscribe` (фреймы текут, только пока участник говорит) и сразу
 * декодируем Opus (48 кГц) в моно-PCM 16 кГц — стоп на выходе мгновенный, без
 * долгого декодирования в обработчике. На финале PCM нарезается на WAV-файлы
 * (чанки по ~20 МБ, см. wav.ts).
 */
import {
  EndBehaviorType,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from '@discordjs/voice';
import OpusScript from 'opusscript';
import type { Logger } from '../../core/index.ts';
import {
  MAX_WAV_CHUNK_BYTES,
  buildWav,
  chunkBytes,
  resample48kTo16k,
  WAV_SAMPLE_RATE,
} from './wav.ts';

/** ChannelType.GuildVoice (числовой enum discord.js; тут без импорта discord.js). */
const CHANNEL_TYPE_GUILD_VOICE = 2;
/** Сколько ждать готовности голосового подключения, мс. */
const JOIN_TIMEOUT_MS = 15_000;
/** Максимум файлов в одном сообщении Discord. */
const DEFAULT_MAX_FILES = 10;
/** Лимит записи по умолчанию, мс (30 минут). */
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
/** Частота фреймов Discord-голоса (декодер обязан совпадать с ней). */
const OPUS_RATE = 48000;
/** Каналы декодера: 1 — стерео-фреймы даунмиксятся самим декодером. */
const OPUS_CHANNELS = 1;
/** Копим PCM в части по ~256 КБ, чтобы не плодить тысячи мелких буферов. */
const PCM_FLUSH_BYTES = 256 * 1024;

// ===== типы, видимые модулю (структурные, без деталей Discord API) =====

export interface MemberVoiceChannel {
  guildId: string;
  channelId: string;
}

export interface GuildMemberLike {
  id: string;
  user?: { username?: string } | null;
}

export interface ChannelLike {
  id: string;
  type: number;
  name?: string | null;
  /** Неизвестный на уровне типа (у «голосовых» — Collection участников). */
  members?: unknown;
  isSendable?(): boolean;
  send?(payload: unknown): Promise<unknown>;
}

export interface GuildLike {
  id: string;
  voiceAdapterCreator: DiscordGatewayAdapterCreator;
  channels: { cache: { get(channelId: string): ChannelLike | undefined } };
}

export interface ClientLike {
  user?: { id?: string } | null;
  guilds: { cache: { get(guildId: string): GuildLike | undefined } };
  channels: { cache: { get(channelId: string): ChannelLike | undefined } };
}

export type StartOutcome = { ok: true } | { ok: false; error: string };

export interface RecordedFile {
  name: string;
  username: string;
  data: Uint8Array;
}

export type StopOutcome =
  | { ok: true; files: RecordedFile[]; durationMs: number; speakers: number; truncated: boolean }
  | { ok: false; error: string };

export interface SessionStatus {
  channelId: string;
  channelName: string | undefined;
  startedAt: number;
  speakers: number;
}

/** Авто-остановка (лимит времени, выход из канала, разрыв соединения). */
export interface AutoStopInfo {
  guildId: string;
  textChannelId: string;
  reason: string;
  outcome: StopOutcome;
}

/** Человекочитаемое описание ошибки для логов и ответов (Error сериализуется в `{}`). */
export function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const str = String(err);
  return str === '[object Object]' ? JSON.stringify(err) : str;
}

/** Инжектируемые зависимости: по умолчанию реальные, в тестах — фейки. */
export interface RecorderDeps {
  maxDurationMs: number;
  maxFiles: number;
  /** Максимальный размер одного WAV-файла (длинные записи режутся на чанки). */
  maxChunkBytes: number;
  join(guildId: string, channelId: string, adapterCreator: DiscordGatewayAdapterCreator): Promise<VoiceConnection>;
  /** Существующее соединение гильдии (для зачистки осиротевших). */
  getConnection(guildId: string): VoiceConnection | undefined;
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancelSchedule(handle: unknown): void;
}

export interface Recorder {
  memberChannelOf(userId: string): MemberVoiceChannel | undefined;
  start(guildId: string, channelId: string, textChannelId: string, requestedBy: string): Promise<StartOutcome>;
  stop(guildId: string): StopOutcome;
  status(guildId: string): SessionStatus | undefined;
  handleVoiceState(userId: string, guildId: string, newChannelId: string | null, isSelf: boolean, username?: string): void;
  dispose(): void;
  onAutoStop?: (info: AutoStopInfo) => void;
}

const defaultDeps: RecorderDeps = {
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  maxFiles: DEFAULT_MAX_FILES,
  maxChunkBytes: MAX_WAV_CHUNK_BYTES,
  join: async (guildId, channelId, adapterCreator) => {
    // selfDeaf: false — запись требует приёма звука, отключённый приёмник не запишет ни фрейма.
    const connection = joinVoiceChannel({ channelId, guildId, adapterCreator, selfDeaf: false });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
      return connection;
    } catch (err) {
      // Полуподключённый бот не должен висеть в канале: оставляем канал и пробрасываем причину.
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw err;
    }
  },
  getConnection: (guildId) => getVoiceConnection(guildId),
  now: () => Date.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancelSchedule: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined),
};

interface Session {
  guildId: string;
  channelId: string;
  channelName: string | undefined;
  textChannelId: string;
  requestedBy: string;
  connection: VoiceConnection;
  /** userId → накопитель PCM 16 кГц (декодировано и ресемплировано на лету). */
  pcm: Map<string, PcmAccumulator>;
  decoders: Map<string, OpusScript>;
  userNames: Map<string, string>;
  startedAt: number;
  timer?: unknown;
}

/** Накопитель PCM: крупные части + незакрытый хвост (досбрасывается при финализации). */
interface PcmAccumulator {
  parts: Buffer[];
  piece: Buffer[];
  pieceBytes: number;
  /** Досброс незакрытого хвоста в parts. */
  flush(): void;
}

const createPcmAccumulator = (): PcmAccumulator => {
  const acc: PcmAccumulator = {
    parts: [],
    piece: [],
    pieceBytes: 0,
    flush() {
      if (acc.piece.length > 0) {
        acc.parts.push(Buffer.concat(acc.piece));
        acc.piece = [];
        acc.pieceBytes = 0;
      }
    },
  };
  return acc;
};

/** Экранирует имя пользователя до безопасного имени файла (буквы Unicode сохраняются). */
export function sanitizeFilename(name: string): string {
  const clean = name
    .normalize('NFC')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return clean.length > 0 ? clean : 'user';
}

/** Время начала записи для имени файла: 20240805-143000. */
export function timestampFor(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Создаёт записыватель голосовых каналов. */
export function createRecorder(client: ClientLike, logger: Logger, overrides: Partial<RecorderDeps> = {}): Recorder {
  const deps: RecorderDeps = { ...defaultDeps, ...overrides };
  const sessions = new Map<string, Session>();
  const memberChannels = new Map<string, MemberVoiceChannel>();

  const attachUser = (session: Session, userId: string, username?: string): void => {
    if (session.pcm.has(userId) || userId === client.user?.id) return;
    const stream = session.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });
    const decoder = new OpusScript(OPUS_RATE, OPUS_CHANNELS);
    const acc = createPcmAccumulator();
    session.decoders.set(userId, decoder);
    session.pcm.set(userId, acc);
    if (username) session.userNames.set(userId, username);
    stream.on('data', (chunk: Buffer) => {
      let pcm: Buffer;
      try {
        pcm = decoder.decode(chunk);
      } catch {
        return; // битый/мусорный фрейм — пропускаем, остальное продолжает писаться
      }
      const resampled = resample48kTo16k(pcm);
      acc.piece.push(resampled);
      acc.pieceBytes += resampled.length;
      if (acc.pieceBytes >= PCM_FLUSH_BYTES) acc.flush();
    });
    stream.on('error', (err) => {
      logger.warn('recorder: ошибка приёма звука', { error: describeError(err), userId });
    });
  };

  /** Синхронно финализирует сессию: таймер, WAV-чанки, destroy соединения. */
  const finalize = (session: Session): StopOutcome => {
    if (session.timer !== undefined) deps.cancelSchedule(session.timer);
    const files: RecordedFile[] = [];
    let speakers = 0;
    let truncated = false;
    const stamp = timestampFor(session.startedAt);
    for (const [userId, acc] of session.pcm) {
      acc.flush();
      if (acc.parts.length === 0) continue;
      speakers++;
      const username = session.userNames.get(userId) ?? userId;
      const slug = sanitizeFilename(username);
      const chunks = chunkBytes(Buffer.concat(acc.parts), deps.maxChunkBytes);
      for (let i = 0; i < chunks.length; i++) {
        if (files.length >= deps.maxFiles) {
          truncated = true;
          break;
        }
        const name = chunks.length > 1 ? `${slug}-${stamp}-${i + 1}.wav` : `${slug}-${stamp}.wav`;
        files.push({ name, username, data: buildWav(chunks[i]!) });
      }
    }
    for (const decoder of session.decoders.values()) {
      try {
        decoder.delete();
      } catch {
        // уже освобождён
      }
    }
    session.decoders.clear();
    destroyConnection(session.connection);
    return { ok: true, files, durationMs: deps.now() - session.startedAt, speakers, truncated };
  };

  /** Разрушает соединение безопасно (повторный destroy кидает). */
  const destroyConnection = (connection: VoiceConnection): void => {
    if (connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy();
    } catch (err) {
      logger.warn('recorder: не удалось уничтожить голосовое соединение', { error: describeError(err) });
    }
  };

  /** Участники голосового канала (только для настоящих голосовых каналов). */
  const voiceChannelMembers = (channel: ChannelLike): Iterable<GuildMemberLike> => {
    if (channel.type !== CHANNEL_TYPE_GUILD_VOICE || !channel.members) return [];
    const members = channel.members as { values?: () => Iterable<GuildMemberLike> };
    return typeof members.values === 'function' ? members.values() : [];
  };

  const recorder: Recorder = {
    memberChannelOf(userId) {
      return memberChannels.get(userId);
    },

    async start(guildId, channelId, textChannelId, requestedBy) {
      if (sessions.has(guildId)) {
        return { ok: false, error: 'В этом сервере уже идёт запись' };
      }
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return { ok: false, error: 'Сервер не найден' };
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== CHANNEL_TYPE_GUILD_VOICE) {
        return { ok: false, error: 'Канал не найден или это не голосовой канал' };
      }

      // Зачистка осиротевших соединений: без активной сессии любое существующее
      // соединение гильдии — мусор от неудачной попытки (joinVoiceChannel иначе
      // переиспользует застрявшее соединение, и бот навсегда «сидит в канале»).
      const orphan = deps.getConnection(guildId);
      if (orphan) destroyConnection(orphan);

      let connection: VoiceConnection;
      try {
        connection = await deps.join(guildId, channelId, guild.voiceAdapterCreator);
      } catch (err) {
        logger.warn('recorder: не удалось подключиться к голосовому каналу', { error: describeError(err) });
        return {
          ok: false,
          error: `Не удалось подключиться к голосовому каналу (${describeError(err)}). Проверьте права Connect/Speak и доступность UDP-порта голосового сервера.`,
        };
      }

      // Гонка двух /record: сессия могла появиться, пока мы подключались.
      if (sessions.has(guildId)) {
        destroyConnection(connection);
        return { ok: false, error: 'В этом сервере уже идёт запись' };
      }

      const session: Session = {
        guildId,
        channelId,
        channelName: channel.name ?? undefined,
        textChannelId,
        requestedBy,
        connection,
        pcm: new Map(),
        decoders: new Map(),
        userNames: new Map(),
        startedAt: deps.now(),
      };
      sessions.set(guildId, session);

      // Подписываемся на всех участников (фреймы текут, пока участник говорит).
      for (const member of voiceChannelMembers(channel)) {
        attachUser(session, member.id, member.user?.username);
      }

      // Лимит длительности — авто-остановка с доставкой в канал старта.
      session.timer = deps.schedule(() => {
        void autoStop(guildId, 'достигнут лимит длительности записи');
      }, deps.maxDurationMs);

      // Разрыв голосового соединения (кик, таймаут) — авто-остановка.
      connection.on('stateChange', (oldState, newState) => {
        if (newState.status !== VoiceConnectionStatus.Disconnected) return;
        if (newState.reason === VoiceConnectionDisconnectReason.Manual) return;
        void autoStop(guildId, 'голосовое соединение разорвано');
      });

      return { ok: true };
    },

    stop(guildId) {
      const session = sessions.get(guildId);
      if (!session) return { ok: false, error: 'Сейчас нет активной записи' };
      sessions.delete(guildId);
      return finalize(session);
    },

    status(guildId) {
      const session = sessions.get(guildId);
      if (!session) return undefined;
      return {
        channelId: session.channelId,
        channelName: session.channelName,
        startedAt: session.startedAt,
        speakers: session.pcm.size,
      };
    },

    handleVoiceState(userId, guildId, newChannelId, isSelf, username) {
      if (newChannelId) {
        memberChannels.set(userId, { guildId, channelId: newChannelId });
        const session = sessions.get(guildId);
        if (session) {
          if (isSelf && session.channelId !== newChannelId) {
            void autoStop(guildId, 'бот перемещён в другой голосовой канал');
          } else if (!isSelf && session.channelId === newChannelId) {
            attachUser(session, userId, username);
          }
        }
      } else {
        memberChannels.delete(userId);
        if (isSelf && sessions.has(guildId)) {
          void autoStop(guildId, 'бот вышел из голосового канала');
        }
      }
    },

    dispose() {
      for (const guildId of [...sessions.keys()]) {
        const session = sessions.get(guildId);
        if (!session) continue;
        sessions.delete(guildId);
        const outcome = finalize(session);
        recorder.onAutoStop?.({ guildId, textChannelId: session.textChannelId, reason: 'бот останавливается', outcome });
      }
    },
  };

  const autoStop = (guildId: string, reason: string): void => {
    const session = sessions.get(guildId);
    if (!session) return;
    sessions.delete(guildId);
    const outcome = finalize(session);
    recorder.onAutoStop?.({ guildId, textChannelId: session.textChannelId, reason, outcome });
  };

  return recorder;
}
