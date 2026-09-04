import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

// ServiceMap аугментирован всеми сервисами — в тесте передаём полный map;
// стаб shikimori не участвует в этих сценариях, но обязателен по типу.
const servicesOf = (weather: { now(city: string): Promise<string> }) => ({
  weather,
  shikimori: {
    search: async () => [],
    top: async () => [],
    animeById: async () => null,
  },
});

describe('модуль forecast', () => {
  test('команда использует сервис weather', async () => {
    const handler = module.handlers.find((h) => h.name === 'forecast')!;
    const result = await runHandler(handler, {
      args: { city: 'Казань' },
      services: servicesOf({ now: async () => 'Казань: +10°' }),
    });
    expect(result).toMatchObject({ kind: 'message' });
    if (result.kind === 'message') expect(result.content).toContain('Казань');
  });

  test('дефолтный город — Москва', async () => {
    const handler = module.handlers.find((h) => h.name === 'forecast')!;
    const result = await runHandler(handler, {
      services: servicesOf({ now: async (city: string) => `${city}` }),
    });
    if (result.kind === 'message') expect(result.content).toBe('Москва');
  });
});
