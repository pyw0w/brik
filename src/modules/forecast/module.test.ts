import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

const shikimoriStub = {
  search: async () => [],
  top: async () => [],
  animeById: async () => null,
};

describe('модуль forecast', () => {
  test('команда использует сервис weather', async () => {
    const handler = module.handlers.find((h) => h.name === 'forecast')!;
    const result = await runHandler(handler, {
      args: { city: 'Казань' },
      services: { weather: { now: async () => 'Казань: +10°' }, shikimori: shikimoriStub },
    });
    expect(result).toMatchObject({ kind: 'message' });
    if (result.kind === 'message') expect(result.content).toContain('Казань');
  });

  test('дефолтный город — Москва', async () => {
    const handler = module.handlers.find((h) => h.name === 'forecast')!;
    const result = await runHandler(handler, {
      services: { weather: { now: async (city) => `${city}` }, shikimori: shikimoriStub },
    });
    if (result.kind === 'message') expect(result.content).toBe('Москва');
  });
});
