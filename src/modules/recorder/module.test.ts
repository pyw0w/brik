import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import OpusScript from 'opusscript';
import { runHandler, createContext } from '../../core/testing.ts';
import module, {
  buildStopResult,
  deliverAutoStop,
  formatDuration,
  parseChannelMention,
  pluralize,
  resolveTargetChannel,
  setRecorderForTest,
} from './module.ts';
import {
  WAV_SAMPLE_RATE,
  buildWav,
  chunkBytes,
  pcmDurationMs,
  resample48kTo16k,
} from './wav.ts';
import {
  createRecorder,
  describeError,
  sanitizeFilename,
  timestampFor,
  type ChannelLike,
  type ClientLike,
  type Recorder,
  type RecorderDeps,
} from './voice.ts';
import type { DiscordGatewayAdapterCreator, VoiceConnection } from '@discordjs/voice';

// ===== утилиты =====

const handlerOf = (name: string) => {
  const handler = module.handlers.find((h) => h.name === name);
  if (!handler) throw new Error(`нет хэндлера ${name}`);
  return handler;
};

/** Фейковый Recorder для тестов хэндлеров. */
const fakeRecorder = (overrides: Partial<Recorder> = {}): Recorder => ({
  memberChannelOf: () => undefined,
  start: async () => ({ ok: false, error: 'not implemented' }),
  stop: () => ({ ok: false, error: 'not implemented' }),
  status: () => undefined,
  handleVoiceState: () => {},
  seedFromClient: () => {},
  dispose: () => {},
  ...overrides,
});

const silentLogger = () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

/** Разбирает WAV: проверяет структуру и возвращает ключевые поля. */
function parseWav(data: Uint8Array): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
  data: Buffer;
} {
  const b = Buffer.from(data);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WAVE');
  expect(b.toString('ascii', 12, 16)).toBe('fmt ');
  expect(b.readUInt16LE(20)).toBe(1); // PCM
  expect(b.readUInt16LE(32)).toBe(b.readUInt16LE(22) * (b.readUInt16LE(34) / 8)); // blockAlign
  expect(b.toString('ascii', 36, 40)).toBe('data');
  const dataSize = b.readUInt32LE(40);
  return {
    sampleRate: b.readUInt32LE(24),
    channels: b.readUInt16LE(22),
    bitsPerSample: b.readUInt16LE(34),
    dataSize,
    data: b.subarray(44, 44 + dataSize),
  };
}

/** Кодирует n фреймов синуса (моно, 48 кГц, 20 мс) через opusscript. */
function encodeSine(n: number): Buffer[] {
  const enc = new OpusScript(48000, 1);
  const frames: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const pcm = new Int16Array(960);
    for (let s = 0; s < 960; s++) {
      pcm[s] = Math.round(Math.sin((2 * Math.PI * 440 * (i * 960 + s)) / 48000) * 8000);
    }
    frames.push(enc.encode(Buffer.from(pcm.buffer), 960));
  }
  return frames;
}

// ===== WAV-конвейер =====

describe('wav: конвейер PCM → файл', () => {
  test('buildWav: поля заголовка', () => {
    const pcm = Buffer.alloc(640, 7); // 320 сэмплов @16 кГц = 20 мс
    const wav = buildWav(pcm);
    const info = parseWav(wav);
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataSize).toBe(640);
    expect(info.data.equals(pcm)).toBe(true);
    // размер RIFF-чанка: 36 + данные
    expect(Buffer.from(wav).readUInt32LE(4)).toBe(36 + 640);
    // byteRate = 16000 × 1 × 2
    expect(Buffer.from(wav).readUInt32LE(28)).toBe(32000);
    expect(WAV_SAMPLE_RATE).toBe(16000);
  });

  test('buildWav: кастомный формат', () => {
    const info = parseWav(buildWav(Buffer.alloc(4), 48000, 2, 16));
    expect(info.sampleRate).toBe(48000);
    expect(info.channels).toBe(2);
    expect(Buffer.from(buildWav(Buffer.alloc(4), 48000, 2, 16)).readUInt32LE(28)).toBe(48000 * 2 * 2);
  });

  test('resample48kTo16k: усреднение по тройкам', () => {
    const input = Buffer.alloc(12); // 6 сэмплов
    [1000, 2000, 3000, 4000, 5000, 6000].forEach((v, i) => input.writeInt16LE(v, i * 2));
    const out = resample48kTo16k(input);
    expect(out.length).toBe(4);
    expect(out.readInt16LE(0)).toBe(2000);
    expect(out.readInt16LE(2)).toBe(5000);
  });

  test('resample48kTo16k: неполная тройка отбрасывается, длина = n/3', () => {
    const input = Buffer.alloc(14); // 7 сэмплов
    for (let i = 0; i < 7; i++) input.writeInt16LE(100, i * 2);
    const out = resample48kTo16k(input);
    expect(out.length).toBe(2 * 2);
  });

  test('chunkBytes: границы и чётное выравнивание', () => {
    const data = Buffer.alloc(10, 1);
    expect(chunkBytes(data, 8)).toEqual([Buffer.alloc(8, 1), Buffer.alloc(2, 1)]);
    // нечётный max округляется вниз до чётного — сэмплы не режутся
    expect(chunkBytes(data, 9).map((c) => c.length)).toEqual([8, 2]);
    expect(chunkBytes(data, 10)).toEqual([data]);
    expect(chunkBytes(data, 100)).toEqual([data]);
    expect(chunkBytes(Buffer.alloc(0), 8)).toEqual([Buffer.alloc(0)]);
  });

  test('pcmDurationMs', () => {
    expect(pcmDurationMs(32000)).toBe(1000);
    expect(pcmDurationMs(640)).toBe(20);
  });

  test('сквозной конвейер: opus → декод → ресемплинг → wav', () => {
    const frames = encodeSine(10);
    const dec = new OpusScript(48000, 1);
    const pcm48: Buffer[] = [];
    for (const f of frames) pcm48.push(dec.decode(f));
    const pcm16 = resample48kTo16k(Buffer.concat(pcm48));
    const wav = buildWav(pcm16);
    const info = parseWav(wav);
    // 10 фреймов × 960 сэмплов @48к → /3 = 3200 сэмплов @16к = 6400 байт
    expect(info.dataSize).toBe(10 * 960 / 3 * 2);
    expect(info.sampleRate).toBe(16000);
    let energy = 0;
    for (let i = 0; i < info.data.length; i += 2) energy += Math.abs(info.data.readInt16LE(i));
    expect(energy).toBeGreaterThan(0);
  });
});

// ===== чистая логика модуля =====

describe('recorder: чистая логика', () => {
  test('parseChannelMention', () => {
    expect(parseChannelMention('<#123456789012345678>')).toBe('123456789012345678');
    expect(parseChannelMention('  123456789012345678  ')).toBe('123456789012345678');
    expect(parseChannelMention('123')).toBeNull();
    expect(parseChannelMention('#general')).toBeNull();
    expect(parseChannelMention('')).toBeNull();
  });

  test('resolveTargetChannel: явный канал', () => {
    expect(resolveTargetChannel({ guildId: 'g1', channel: '<#123456789012345678>' })).toEqual({
      guildId: 'g1',
      channelId: '123456789012345678',
    });
    expect(resolveTargetChannel({ guildId: 'g1', channel: '123456789012345678' })).toEqual({
      guildId: 'g1',
      channelId: '123456789012345678',
    });
    expect(resolveTargetChannel({ guildId: 'g1', channel: 'неканал' })).toBeNull();
  });

  test('resolveTargetChannel: голосовой канал автора', () => {
    const member = { guildId: 'g1', channelId: 'vc1' };
    expect(resolveTargetChannel({ guildId: 'g1', memberChannel: member })).toEqual({ guildId: 'g1', channelId: 'vc1' });
    expect(resolveTargetChannel({ guildId: 'g1', memberChannel: { guildId: 'g2', channelId: 'vc1' } })).toBeNull();
    expect(resolveTargetChannel({ guildId: 'g1' })).toBeNull();
    expect(resolveTargetChannel({ channel: '<#123>' })).toBeNull();
  });

  test('pluralize', () => {
    expect(pluralize(1, ['файл', 'файла', 'файлов'])).toBe('файл');
    expect(pluralize(2, ['файл', 'файла', 'файлов'])).toBe('файла');
    expect(pluralize(5, ['файл', 'файла', 'файлов'])).toBe('файлов');
    expect(pluralize(11, ['файл', 'файла', 'файлов'])).toBe('файлов');
    expect(pluralize(21, ['файл', 'файла', 'файлов'])).toBe('файл');
  });

  test('formatDuration', () => {
    expect(formatDuration(0)).toBe('0 секунд');
    expect(formatDuration(5_000)).toBe('5 секунд');
    expect(formatDuration(65_000)).toBe('1 минута 5 секунд');
    expect(formatDuration(3_661_000)).toBe('1 час 1 минута 1 секунда');
  });

  test('buildStopResult: файлы → multiple с вложениями', () => {
    const result = buildStopResult({
      ok: true,
      durationMs: 30_000,
      speakers: 2,
      truncated: false,
      files: [
        { name: 'alena-20240805.wav', username: 'alena', data: new Uint8Array([1, 2, 3]) },
        { name: 'boba-20240805.wav', username: 'boba', data: new Uint8Array([4, 5]) },
      ],
    });
    expect(result.kind).toBe('multiple');
    if (result.kind === 'multiple') {
      expect(result.results[0]).toMatchObject({ kind: 'message', content: expect.stringContaining('2 файла') });
      const attachments = result.results.filter((r) => r.kind === 'attachment');
      expect(attachments).toHaveLength(2);
      expect(attachments[0]).toMatchObject({ kind: 'attachment', file: { name: 'alena-20240805.wav' } });
    }
  });

  test('buildStopResult: никто не говорил', () => {
    const result = buildStopResult({ ok: true, durationMs: 12_000, speakers: 0, truncated: false, files: [] });
    expect(result).toMatchObject({ kind: 'message', content: expect.stringContaining('Никто не говорил') });
  });

  test('buildStopResult: усечение при лимите вложений', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `u${i}.wav`,
      username: `u${i}`,
      data: new Uint8Array([i]),
    }));
    const result = buildStopResult({ ok: true, durationMs: 1000, speakers: 15, truncated: true, files });
    if (result.kind === 'multiple') {
      const last = result.results[result.results.length - 1];
      expect(last).toMatchObject({ kind: 'message', content: expect.stringContaining('⚠️') });
    }
  });

  test('sanitizeFilename и timestampFor', () => {
    expect(sanitizeFilename('Алёна Иванова')).toBe('Алёна-Иванова');
    expect(sanitizeFilename('Boba')).toBe('Boba');
    expect(sanitizeFilename('!!!')).toBe('user');
    expect(sanitizeFilename('/etc/passwd')).toBe('etc-passwd');
    const t = new Date(2024, 7, 5, 14, 30, 0).getTime();
    expect(timestampFor(t)).toBe('20240805-143000');
  });
});

// ===== хэндлеры =====

describe('recorder: хэндлеры', () => {
  beforeEach(() => setRecorderForTest(undefined));
  afterEach(() => setRecorderForTest(undefined));

  test('оффлайн: все команды отвечают «недоступно»', async () => {
    for (const name of ['record', 'record-stop', 'record-status']) {
      const result = await runHandler(handlerOf(name), { args: {} });
      expect(result).toMatchObject({ kind: 'message', ephemeral: true, content: expect.stringContaining('недоступна') });
    }
  });

  test('вне сервера: отклоняется', async () => {
    const input = {
      commandName: 'record',
      args: {},
      author: { id: 'user1', username: 'User' },
      channel: { id: 'dm1' },
    };
    const result = await runHandler(handlerOf('record'), { input });
    expect(result).toMatchObject({ kind: 'message', content: 'Только на сервере' });
  });

  test('/record без канала и вне голосового канала', async () => {
    setRecorderForTest(fakeRecorder({ memberChannelOf: () => undefined }));
    const result = await runHandler(handlerOf('record'), { args: {} });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true, content: expect.stringContaining('Вы не в голосовом канале') });
  });

  test('/record с каналом: стартует и отвечает', async () => {
    const start = async () => ({ ok: true } as const);
    setRecorderForTest(fakeRecorder({ memberChannelOf: () => undefined, start }));
    const result = await runHandler(handlerOf('record'), { args: { channel: '<#123456789012345678>' } });
    expect(result).toMatchObject({ kind: 'message', content: expect.stringContaining('Записываю <#123456789012345678>') });
  });

  test('/record использует голосовой канал автора', async () => {
    const member = { guildId: 'guild1', channelId: 'vc1' };
    let started: { guildId: string; channelId: string } | undefined;
    setRecorderForTest(
      fakeRecorder({
        memberChannelOf: () => member,
        start: async (guildId, channelId) => {
          started = { guildId, channelId };
          return { ok: true } as const;
        },
      }),
    );
    await runHandler(handlerOf('record'), { args: {} });
    expect(started).toEqual({ guildId: 'guild1', channelId: 'vc1' });
  });

  test('/record: ошибка старта → ephemeral', async () => {
    setRecorderForTest(fakeRecorder({ start: async () => ({ ok: false, error: 'уже идёт запись' }) }));
    const result = await runHandler(handlerOf('record'), { args: { channel: '<#123>' } });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true, content: 'уже идёт запись' });
  });

  test('/record-stop: файлы приходят вложением', async () => {
    setRecorderForTest(
      fakeRecorder({
        stop: () => ({
          ok: true,
          durationMs: 10_000,
          speakers: 1,
          truncated: false,
          files: [{ name: 'boba-20240805.wav', username: 'boba', data: new Uint8Array([1, 2, 3]) }],
        }),
      }),
    );
    const result = await runHandler(handlerOf('record-stop'), { args: {} });
    expect(result.kind).toBe('multiple');
    if (result.kind === 'multiple') {
      const attachments = result.results.filter((r) => r.kind === 'attachment');
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({ kind: 'attachment', file: { name: 'boba-20240805.wav' } });
    }
  });

  test('/record-stop: без записи → ephemeral', async () => {
    setRecorderForTest(fakeRecorder({ stop: () => ({ ok: false, error: 'Сейчас нет активной записи' }) }));
    const result = await runHandler(handlerOf('record-stop'), { args: {} });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true, content: 'Сейчас нет активной записи' });
  });

  test('/record-status: активная запись и пусто', async () => {
    setRecorderForTest(fakeRecorder({ status: () => ({ channelId: 'vc1', channelName: 'Голосовой', startedAt: Date.now() - 30_000, speakers: 2 }) }));
    const result = await runHandler(handlerOf('record-status'), { args: {} });
    expect(result).toMatchObject({ kind: 'message', content: expect.stringContaining('Идёт запись') });

    setRecorderForTest(fakeRecorder({ status: () => undefined }));
    const empty = await runHandler(handlerOf('record-status'), { args: {} });
    expect(empty).toMatchObject({ kind: 'message', ephemeral: true, content: 'Сейчас нет активной записи' });
  });

  test('deliverAutoStop: отправляет в канал старта', async () => {
    const sends: unknown[] = [];
    const client: ClientLike = {
      user: { id: 'bot' },
      guilds: { cache: { get: () => undefined } },
      channels: {
        cache: {
          get: (id) =>
            id === 'text1'
              ? ({ id: 'text1', type: 0, isSendable: () => true, send: async (p) => { sends.push(p); return p; } } as ChannelLike)
              : undefined,
        },
      },
    };
    await deliverAutoStop(client, {
      textChannelId: 'text1',
      reason: 'бот вышел из голосового канала',
      outcome: { ok: true, durationMs: 1000, speakers: 1, truncated: false, files: [{ name: 'a.wav', username: 'a', data: new Uint8Array([9]) }] },
    }, silentLogger());
    expect(sends).toHaveLength(1);
    const payload = sends[0] as { content: string; files: unknown[] };
    expect(payload.content).toContain('бот вышел из голосового канала');
    expect(payload.files).toHaveLength(1);
  });

  test('deliverAutoStop: недоступный канал → warn', async () => {
    const warns: unknown[] = [];
    const logger = { ...silentLogger(), warn: (m: string) => { warns.push(m); } };
    const client: ClientLike = {
      user: { id: 'bot' },
      guilds: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    };
    await deliverAutoStop(client, {
      textChannelId: 'none',
      reason: 'x',
      outcome: { ok: true, durationMs: 1, speakers: 0, truncated: false, files: [] },
    }, logger);
    expect(warns).toHaveLength(1);
  });
});

// ===== onReady / onShutdown (module.ts) =====

/** Диск-клиент для onReady: EventEmitter + каналы доставки + голосовые состояния для сида. */
function fakeReadyClient(voiceStates: Array<{ id: string; channelId: string | null; member?: { user?: { username?: string } | null } | null }> = []) {
  const deliveries: { channelId: string; payload: unknown }[] = [];
  const sendable = (id: string) => ({
    id,
    isSendable: () => true,
    send: async (payload: unknown) => {
      deliveries.push({ channelId: id, payload });
    },
  });
  const channels = new Map<string, ReturnType<typeof sendable>>([
    ['text1', sendable('text1')],
  ]);
  const guild = {
    id: 'g1',
    voiceStates: { cache: { values: () => voiceStates } },
    channels: { cache: { get: (_id: string) => undefined } },
  };
  const client = Object.assign(new EventEmitter(), {
    user: { id: 'bot-id' },
    channels: { cache: { get: (id: string) => channels.get(id) } },
    guilds: { cache: { get: (_guildId: string) => undefined, values: () => [guild] } },
  }) as unknown as import('../../core/index.ts').ModuleReadyContext['client'];
  return { client, deliveries };
}

describe('recorder: onReady / onShutdown', () => {
  afterEach(() => setRecorderForTest(undefined));

  test('onReady включает модуль: voiceStateUpdate доходит до Recorder', async () => {
    const { client } = fakeReadyClient();
    const ctx = createContext();
    await module.onReady?.({
      client,
      store: ctx.store,
      memory: ctx.memory,
      logger: silentLogger(),
      commands: { list: () => [] },
      options: { maxDurationSeconds: 1800, maxFiles: 10 },
      services: ctx.services,
    });

    // Пользователь заходит в голосовой канал: подписка onReady пробрасывает
    // событие в Recorder — карта каналов заполняется. Гильдии в фейк-клиенте
    // нет, поэтому /record без явного канала честно ответит «не в голосовом
    // канале» (карта реального Recorder-а не знает пользователя до события).
    (client as unknown as { emit(event: string, ...args: unknown[]): boolean }).emit('voiceStateUpdate', undefined, {
      id: 'u1',
      guild: { id: 'g1' },
      channelId: 'vc1',
      member: { user: { username: 'alena' } },
    });

    // Модуль включён: ответ уже не «недоступна» (Recorder создан и подписан).
    const result = await runHandler(handlerOf('record'), {
      input: { commandName: 'record', args: {}, author: { id: 'u1', username: 'alena' }, channel: { id: 'text1', guildId: 'g1' } },
    });
    expect(result).not.toMatchObject({ content: expect.stringContaining('недоступна') });
    module.onShutdown?.();
  });

  test('onReady сидит карту каналов: пользователь, сидевший в войсе до подключения, доступен для /record', async () => {
    // alena сидела в vc1 ДО старта бота — voiceStateUpdate для неё не придёт
    const { client } = fakeReadyClient([
      { id: 'u1', channelId: 'vc1', member: { user: { username: 'alena' } } },
      { id: 'bot-id', channelId: 'vc1' }, // сам бот — не в карту
    ]);
    const ctx = createContext();
    await module.onReady?.({
      client,
      store: ctx.store,
      memory: ctx.memory,
      logger: silentLogger(),
      commands: { list: () => [] },
      options: { maxDurationSeconds: 1800, maxFiles: 10 },
      services: ctx.services,
    });

    // /record от alena без аргумента: её канал находится по сид-карте
    // (гильдии в фейк-клиенте нет → честный ответ «канал не найден»,
    // но НЕ «вы не в голосовом канале» — карта работает)
    const result = await runHandler(handlerOf('record'), {
      input: { commandName: 'record', args: {}, author: { id: 'u1', username: 'alena' }, channel: { id: 'text1', guildId: 'g1' } },
    });
    if (result.kind === 'message') {
      expect(result.content).not.toContain('Вы не в голосовом канале');
    }
    module.onShutdown?.();
  });

  test('onShutdown освобождает модуль: команды снова «недоступны»', async () => {
    const { client } = fakeReadyClient();
    const ctx = createContext();
    await module.onReady?.({
      client,
      store: ctx.store,
      memory: ctx.memory,
      logger: silentLogger(),
      commands: { list: () => [] },
      options: { maxDurationSeconds: 1800, maxFiles: 10 },
      services: ctx.services,
    });
    module.onShutdown?.();
    const result = await runHandler(handlerOf('record'), { args: {} });
    expect(result).toMatchObject({ content: expect.stringContaining('недоступна') });
  });
});

interface FakeConn {
  subscriptions: Map<string, EventEmitter>;
  stateListeners: ((oldState: unknown, newState: unknown) => void)[];
  destroyed: boolean;
  state: { status: string };
  receiver: { subscribe(userId: string): EventEmitter };
  on(event: string, cb: (oldState: unknown, newState: unknown) => void): void;
  destroy(): void;
}

const makeConnection = (): FakeConn => {
  const conn: FakeConn = {
    subscriptions: new Map(),
    stateListeners: [],
    destroyed: false,
    state: { status: 'ready' },
    receiver: {
      subscribe: (userId) => {
        const stream = new EventEmitter();
        conn.subscriptions.set(userId, stream);
        return stream;
      },
    },
    on: (event, cb) => {
      if (event === 'stateChange') conn.stateListeners.push(cb);
    },
    destroy: () => {
      conn.destroyed = true;
      conn.state = { status: 'destroyed' };
    },
  };
  return conn;
};

interface FakeEnv {
  client: ClientLike;
  guildChannels: Map<string, Map<string, ChannelLike>>;
  guilds: Map<string, { id: string; voiceAdapterCreator: DiscordGatewayAdapterCreator }>;
  addGuild(guildId: string): void;
  addVoiceChannel(guildId: string, channelId: string, members: { id: string; username?: string }[]): void;
}

const makeEnv = (): FakeEnv => {
  const guildChannels = new Map<string, Map<string, ChannelLike>>();
  const guilds = new Map<string, { id: string; voiceAdapterCreator: DiscordGatewayAdapterCreator }>();
  const clientChannels = new Map<string, ChannelLike>();
  const client: ClientLike = {
    user: { id: 'bot-id' },
    guilds: {
      cache: {
        get: (guildId) => {
          const g = guilds.get(guildId);
          if (!g) return undefined;
          return { id: g.id, voiceAdapterCreator: g.voiceAdapterCreator, channels: { cache: { get: (cid) => guildChannels.get(guildId)?.get(cid) } } };
        },
      },
    },
    channels: { cache: { get: (id) => clientChannels.get(id) } },
  };
  return {
    client,
    guildChannels,
    guilds,
    addGuild(guildId) {
      guilds.set(guildId, { id: guildId, voiceAdapterCreator: {} as DiscordGatewayAdapterCreator });
      guildChannels.set(guildId, new Map());
    },
    addVoiceChannel(guildId, channelId, members) {
      const channel: ChannelLike = {
        id: channelId,
        type: 2,
        name: 'Голосовой',
        members: new Map(members.map((m) => [m.id, { id: m.id, user: m.username ? { username: m.username } : null }])),
      };
      guildChannels.get(guildId)!.set(channelId, channel);
    },
  };
};

describe('recorder: сессии (voice.ts)', () => {
  const depsFor = (conn: FakeConn, overrides: Partial<RecorderDeps> = {}): RecorderDeps & { scheduled: (() => void)[] } => {
    const scheduled: (() => void)[] = [];
    return {
      maxDurationMs: 60_000,
      maxFiles: 10,
      maxChunkBytes: 20 * 1024 * 1024,
      join: async () => conn as unknown as VoiceConnection,
      getConnection: () => undefined,
      now: () => 1000,
      schedule: (fn) => {
        scheduled.push(fn);
        return scheduled.length;
      },
      cancelSchedule: () => {},
      scheduled,
      ...overrides,
    };
  };

  test('start: подключается и подписывается на участников (кроме бота)', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [
      { id: 'u1', username: 'alena' },
      { id: 'u2', username: 'boba' },
      { id: 'bot-id', username: 'Brik' },
    ]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    const outcome = await recorder.start('g1', 'vc1', 'text1', 'alena');
    expect(outcome).toEqual({ ok: true });
    expect(conn.subscriptions.has('u1')).toBe(true);
    expect(conn.subscriptions.has('u2')).toBe(true);
    expect(conn.subscriptions.has('bot-id')).toBe(false);
    const status = recorder.status('g1');
    expect(status?.channelName).toBe('Голосовой');
    expect(status?.speakers).toBe(2);
  });

  test('start: повторная запись, нет гильдии, не голосовой канал, join упал', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'a' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    await recorder.start('g1', 'vc1', 'text1', 'a');
    expect(await recorder.start('g1', 'vc1', 'text1', 'a')).toEqual({ ok: false, error: expect.stringContaining('уже идёт запись') });
    expect(await recorder.start('g2', 'vc1', 'text1', 'a')).toEqual({ ok: false, error: 'Сервер не найден' });
    recorder.stop('g1');
    expect(await recorder.start('g1', 'text1', 'text1', 'a')).toEqual({ ok: false, error: expect.stringContaining('не голосовой канал') });

    const recorder2 = createRecorder(env.client, silentLogger(), depsFor(makeConnection(), { join: async () => { throw new Error('perm'); } }));
    expect(await recorder2.start('g1', 'vc1', 'text1', 'a')).toEqual({ ok: false, error: expect.stringContaining('Connect') });
  });

  test('stop: фреймы превращаются в валидный wav-файл', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    for (const f of encodeSine(5)) conn.subscriptions.get('u1')!.emit('data', f);
    const outcome = recorder.stop('g1');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]!.name).toMatch(/^alena-\d{8}-\d{6}\.wav$/);
      const info = parseWav(outcome.files[0]!.data);
      expect(info.sampleRate).toBe(16000);
      // 5 фреймов × 960 сэмплов @48к → /3 = 1600 сэмплов @16к = 3200 байт
      expect(info.dataSize).toBe(5 * 960 / 3 * 2);
      expect(conn.destroyed).toBe(true);
    }
    expect(recorder.stop('g1')).toEqual({ ok: false, error: expect.stringContaining('нет активной записи') });
  });

  test('stop: участники без звука не дают файлов; лимит файлов усекает', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [
      { id: 'u1', username: 'alena' },
      { id: 'u2', username: 'boba' },
      { id: 'u3', username: 'sasha' },
    ]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn, { maxFiles: 2 }));
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    conn.subscriptions.get('u1')!.emit('data', encodeSine(1)[0]!);
    conn.subscriptions.get('u2')!.emit('data', encodeSine(1)[0]!);
    // u3 молчит
    const outcome = recorder.stop('g1');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.speakers).toBe(2);
      expect(outcome.files).toHaveLength(2);
      expect(outcome.truncated).toBe(false);
    }

    const conn2 = makeConnection();
    const recorder2 = createRecorder(env.client, silentLogger(), depsFor(conn2, { maxFiles: 1 }));
    await recorder2.start('g1', 'vc1', 'text1', 'alena');
    conn2.subscriptions.get('u1')!.emit('data', encodeSine(1)[0]!);
    conn2.subscriptions.get('u2')!.emit('data', encodeSine(1)[0]!);
    conn2.subscriptions.get('u3')!.emit('data', encodeSine(1)[0]!);
    const outcome2 = recorder2.stop('g1');
    if (outcome2.ok) {
      expect(outcome2.files).toHaveLength(1);
      expect(outcome2.speakers).toBe(3);
      expect(outcome2.truncated).toBe(true);
    }
  });

  test('битые фреймы не роняют запись', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    const stream = conn.subscriptions.get('u1')!;
    stream.emit('data', Buffer.from([255])); // мусор (Invalid packet)
    stream.emit('data', encodeSine(1)[0]!); // настоящий фрейм
    const outcome = recorder.stop('g1');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.files).toHaveLength(1);
      const info = parseWav(outcome.files[0]!.data);
      expect(info.dataSize).toBe(1 * 960 / 3 * 2);
    }
  });

  test('длинная запись режется на чанки', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn, { maxChunkBytes: 1000 }));
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    for (const f of encodeSine(10)) conn.subscriptions.get('u1')!.emit('data', f);
    const outcome = recorder.stop('g1');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // 10 фреймов → 6400 байт PCM; чанки ≤1000 → 7 файлов.
      expect(outcome.files).toHaveLength(7);
      expect(outcome.files[0]!.name).toMatch(/-1\.wav$/);
      expect(outcome.files[6]!.name).toMatch(/-7\.wav$/);
      const total = outcome.files.reduce((n, f) => n + f.data.length, 0);
      expect(total).toBe(44 * 7 + 6400); // 7 заголовков + PCM
    }
  });

  test('handleVoiceState: карта каналов, джойн в активную сессию, выход бота', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    const autoStops: unknown[] = [];
    recorder.onAutoStop = (info) => autoStops.push(info.reason);

    recorder.handleVoiceState('u1', 'g1', 'vc1', false, 'alena');
    expect(recorder.memberChannelOf('u1')).toEqual({ guildId: 'g1', channelId: 'vc1' });
    recorder.handleVoiceState('u1', 'g1', null, false);
    expect(recorder.memberChannelOf('u1')).toBeUndefined();

    // новый участник в активной сессии — подписывается.
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    recorder.handleVoiceState('u9', 'g1', 'vc1', false, 'newo');
    expect(conn.subscriptions.has('u9')).toBe(true);

    // бот вышел из канала — авто-стоп.
    recorder.handleVoiceState('bot-id', 'g1', null, true);
    expect(autoStops).toEqual([expect.stringContaining('вышел из голосового канала')]);
    expect(recorder.status('g1')).toBeUndefined();
  });

  test('handleVoiceState: перемещение бота и участника', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    env.addVoiceChannel('g1', 'vc2', []);
    const recorder = createRecorder(env.client, silentLogger(), depsFor(makeConnection()));
    const autoStops: unknown[] = [];
    recorder.onAutoStop = (info) => autoStops.push(info.reason);

    await recorder.start('g1', 'vc1', 'text1', 'alena');
    // бота перевели в другой канал → авто-стоп.
    recorder.handleVoiceState('bot-id', 'g1', 'vc2', true);
    expect(autoStops).toEqual([expect.stringContaining('перемещён')]);
    // участник ушёл в другой канал → карта обновилась, подписок новых нет.
    recorder.handleVoiceState('u1', 'g1', 'vc2', false);
    expect(recorder.memberChannelOf('u1')).toEqual({ guildId: 'g1', channelId: 'vc2' });
  });

  test('таймер лимита: авто-стоп с доставкой', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const scheduledFns: (() => void)[] = [];
    const recorder = createRecorder(env.client, silentLogger(), {
      maxDurationMs: 1000,
      maxFiles: 10,
      maxChunkBytes: 20 * 1024 * 1024,
      join: async () => conn as unknown as VoiceConnection,
      getConnection: () => undefined,
      now: () => 1000,
      schedule: (fn) => {
        scheduledFns.push(fn);
        return scheduledFns.length;
      },
      cancelSchedule: () => {},
    });
    const autoStops: unknown[] = [];
    recorder.onAutoStop = (info) => autoStops.push(info);
    const outcome = await recorder.start('g1', 'vc1', 'text1', 'alena');
    expect(outcome.ok).toBe(true);
    expect(scheduledFns).toHaveLength(1);
    expect(autoStops).toHaveLength(0);
    conn.subscriptions.get('u1')!.emit('data', Buffer.from([1, 2, 3])); // битый фрейм — файла не будет, но стоп ок
    scheduledFns[0]!();
    expect(autoStops).toHaveLength(1);
    const info = autoStops[0] as { textChannelId: string; reason: string; outcome: { ok: boolean; files: unknown[] } };
    expect(info.textChannelId).toBe('text1');
    expect(info.reason).toContain('лимит');
    expect(info.outcome.ok).toBe(true);
    expect(recorder.status('g1')).toBeUndefined();
  });

  test('разрыв соединения (stateChange Disconnected) → авто-стоп; Manual — нет', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    const autoStops: unknown[] = [];
    recorder.onAutoStop = (info) => autoStops.push(info);
    await recorder.start('g1', 'vc1', 'text1', 'alena');

    conn.stateListeners.forEach((cb) => cb({}, { status: 'disconnected', reason: 3 })); // Manual
    expect(autoStops).toHaveLength(0);

    conn.stateListeners.forEach((cb) => cb({}, { status: 'disconnected', reason: 0 })); // WebSocketClose
    expect(autoStops).toHaveLength(1);
  });

  test('start: зачищает осиротевшее соединение гильдии перед join', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const orphan = makeConnection();
    const fresh = makeConnection();
    let joined = 0;
    const recorder = createRecorder(env.client, silentLogger(), {
      ...depsFor(fresh),
      getConnection: () => orphan as unknown as VoiceConnection,
      join: async () => {
        joined++;
        return fresh as unknown as VoiceConnection;
      },
    });
    const outcome = await recorder.start('g1', 'vc1', 'text1', 'alena');
    expect(outcome.ok).toBe(true);
    expect(orphan.destroyed).toBe(true);
    expect(joined).toBe(1);
  });

  test('start: гонка двух /record — вторая попытка отклоняется и чистит своё соединение', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn1 = makeConnection();
    const conn2 = makeConnection();
    let calls = 0;
    const recorder = createRecorder(env.client, silentLogger(), {
      ...depsFor(conn1),
      join: async () => {
        await new Promise((r) => setTimeout(r, 5));
        calls++;
        return (calls === 1 ? conn1 : conn2) as unknown as VoiceConnection;
      },
    });
    const [a, b] = await Promise.all([
      recorder.start('g1', 'vc1', 'text1', 'alena'),
      recorder.start('g1', 'vc1', 'text1', 'boba'),
    ]);
    expect(a.ok !== b.ok).toBe(true);
    expect(a.ok || b.ok).toBe(true);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, error: expect.stringContaining('уже идёт запись') });
    expect(conn2.destroyed).toBe(true); // соединение проигравшей попытки уничтожено
  });

  test('stop: двойной destroy не роняет финализацию', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const conn = makeConnection();
    // destroy кидает (соединение уже уничтожено извне) — финализация всё равно работает.
    conn.destroy = () => {
      throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
    };
    const recorder = createRecorder(env.client, silentLogger(), depsFor(conn));
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    conn.subscriptions.get('u1')!.emit('data', encodeSine(1)[0]!);
    const outcome = recorder.stop('g1');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.files).toHaveLength(1);
  });

  test('describeError: реальное сообщение вместо {}', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('строка')).toBe('строка');
    expect(describeError({ code: 7 })).toBe('{"code":7}');
    expect(describeError(undefined)).toBe('undefined');
  });

  test('start: ошибка join содержит причину', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    const recorder = createRecorder(env.client, silentLogger(), {
      ...depsFor(makeConnection()),
      join: async () => {
        throw new Error('The operation was aborted');
      },
    });
    const outcome = await recorder.start('g1', 'vc1', 'text1', 'alena');
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('The operation was aborted'),
    });
    expect(outcome.ok ? '' : outcome.error).toContain('Connect/Speak');
  });

  test('dispose: финализирует все сессии', async () => {
    const env = makeEnv();
    env.addGuild('g1');
    env.addVoiceChannel('g1', 'vc1', [{ id: 'u1', username: 'alena' }]);
    env.addGuild('g2');
    env.addVoiceChannel('g2', 'vc2', [{ id: 'u2', username: 'boba' }]);
    const conn1 = makeConnection();
    const conn2 = makeConnection();
    const recorder = createRecorder(env.client, silentLogger(), {
      ...depsFor(conn1),
      join: async (guildId: string) => (guildId === 'g1' ? conn1 : conn2) as unknown as VoiceConnection,
    });
    await recorder.start('g1', 'vc1', 'text1', 'alena');
    await recorder.start('g2', 'vc2', 'text2', 'boba');
    const autoStops: unknown[] = [];
    recorder.onAutoStop = (info) => autoStops.push(info);
    recorder.dispose();
    expect(autoStops).toHaveLength(2);
    expect(conn1.destroyed).toBe(true);
    expect(conn2.destroyed).toBe(true);
  });
});
