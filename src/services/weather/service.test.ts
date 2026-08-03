import { describe, expect, test } from 'bun:test';
import weatherService, { type WeatherApi } from './service.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const initApi = (options: Record<string, unknown>): WeatherApi =>
  weatherService.init({ options, logger, memory: {} } as never) as WeatherApi;

describe('weather service', () => {
  test('идентифицируется как weather', () => {
    expect(weatherService.name).toBe('weather');
  });

  test('now() без apiKey использует базовое значение 3', async () => {
    const api = initApi({ apiKey: undefined });
    expect(await api.now('Казань')).toBe('В городе Казань сейчас +9°C (демо)');
  });

  test('now() с apiKey учитывает длину ключа', async () => {
    const api = initApi({ apiKey: 'secret' });
    expect(await api.now('Казань')).toBe('В городе Казань сейчас +18°C (демо)');
  });
});
