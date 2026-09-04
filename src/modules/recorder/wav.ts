/**
 * Чистый WAV-конвейер: PCM (16 бит, LE) → WAV-файл, ресемплинг 48→16 кГц, нарезка.
 *
 * Голосовые фреймы Discord (Opus, 48 кГц) декодируются в `voice.ts` в моно-PCM
 * (декодер OpusScript создаётся с каналами=1: стерео-фреймы даунмиксятся декодером
 * сам, длительность не меняется). Здесь — только чистая обработка PCM:
 * никаких внешних зависимостей, всё экспортировано для тестов.
 *
 * Формат на выходе: WAV, 16 бит, моно, 16 кГц — стандарт для голосовых записей,
 * в 4 раза компактнее 48 кГц и влезает в лимит вложений Discord (25 МБ ≈ 13 минут).
 */

/** Частота дискретизации выходного WAV. */
export const WAV_SAMPLE_RATE = 16000;
/** Входной PCM всегда 48 кГц (дешифровка Discord-голоса). */
const INPUT_SAMPLE_RATE = 48000;
/** Максимальный размер одного WAV-файла: 20 МБ (запас под лимит Discord 25 МБ). */
export const MAX_WAV_CHUNK_BYTES = 20 * 1024 * 1024;

/** Заголовок RIFF/WAVE + тело PCM (16 бит, LE). */
export function buildWav(
  pcm: Uint8Array,
  sampleRate = WAV_SAMPLE_RATE,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const dataSize = pcm.length;
  const bytesPerSample = bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // размер fmt-чанка
  header.writeUInt16LE(1, 20); // PCM (linear quantization)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byteRate
  header.writeUInt16LE(channels * bytesPerSample, 32); // blockAlign
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/**
 * Ресемплинг моно-PCM 48 кГц → 16 кГц (ровно 3:1).
 * Простой box-фильтр: каждые 3 входных сэмпла усредняются — это и низкочастотная
 * фильтрация против алиасинга, и децимация в один проход. Для речи — достаточно.
 */
export function resample48kTo16k(pcm: Uint8Array): Buffer {
  const frames = Math.floor(pcm.length / 2 / 3);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const a = pcm[i * 6]! | (pcm[i * 6 + 1]! << 8);
    const b = pcm[i * 6 + 2]! | (pcm[i * 6 + 3]! << 8);
    const c = pcm[i * 6 + 4]! | (pcm[i * 6 + 5]! << 8);
    const avg = Math.round((toInt16(a) + toInt16(b) + toInt16(c)) / 3);
    out.writeInt16LE(avg, i * 2);
  }
  return out;
}

/** Сырые 16 бит LE → знаковое число. */
const toInt16 = (raw: number): number => (raw << 16) >> 16;

/** Режет PCM на куски не больше maxBytes (границы чётные — сэмплы не режутся). */
export function chunkBytes(data: Uint8Array, maxBytes: number): Uint8Array[] {
  const safe = maxBytes - (maxBytes % 2);
  if (data.length <= safe) return [data];
  const out: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += safe) {
    out.push(data.slice(off, Math.min(off + safe, data.length)));
  }
  return out;
}

/** Длительность PCM-буфера (моно, 16 бит) в миллисекундах. */
export function pcmDurationMs(pcmBytes: number, sampleRate = WAV_SAMPLE_RATE): number {
  return (pcmBytes / 2 / sampleRate) * 1000;
}
