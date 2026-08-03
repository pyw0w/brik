import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

const weatherStub = { now: async () => '' };

const summary = (over: Record<string, unknown> = {}) => ({
  id: 52991,
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  kind: 'tv',
  status: 'released',
  score: 9.1,
  episodes: 28,
  url: 'https://shikimori.one/animes/52991',
  airedOn: '2023-09-29',
  poster: null,
  ...over,
});

const findHandler = (name: string) => module.handlers.find((h) => h.name === name)!;

describe('модуль anime', () => {
  test('search возвращает список результатов', async () => {
    const services = {
      shikimori: {
        search: async () => [summary(), summary({ id: 2, name: 'Naruto', russian: null, score: 8.5 })],
        top: async () => [],
        animeById: async () => null,
      },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('search'), { args: { query: 'фрирен', limit: 2 }, services });
    expect(result.kind).toBe('embed');
  });

  test('search с пустым результатом пишет «Ничего не найдено»', async () => {
    const services = {
      shikimori: { search: async () => [], top: async () => [], animeById: async () => null },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('search'), { args: { query: 'zzz' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toContain('Ничего не найдено');
  });

  test('search дефолтный limit = 5', async () => {
    let requestedLimit: number | undefined;
    const services = {
      shikimori: {
        search: async (_q: string, limit?: number) => {
          requestedLimit = limit;
          return [summary()];
        },
        top: async () => [],
        animeById: async () => null,
      },
      weather: weatherStub,
    };
    await runHandler(findHandler('search'), { args: { query: 'x' }, services });
    expect(requestedLimit).toBe(5);
  });

  test('top возвращает список', async () => {
    const services = {
      shikimori: {
        search: async () => [],
        top: async () => [summary(), summary({ id: 3, name: 'AoT', russian: 'Атака титанов' })],
        animeById: async () => null,
      },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('top'), { args: { limit: 2 }, services });
    expect(result.kind).toBe('embed');
  });

  test('ошибка сервиса → дружелюбный текст', async () => {
    const services = {
      shikimori: {
        search: async () => { throw new Error('boom'); },
        top: async () => [],
        animeById: async () => null,
      },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('search'), { args: { query: 'x' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toContain('Не удалось получить данные от Shikimori');
  });
});

const details = {
  id: 52991,
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  kind: 'tv',
  status: 'released',
  score: 9.1,
  episodes: 28,
  url: 'https://shikimori.one/animes/52991',
  airedOn: '2023-09-29',
  duration: 24,
  description: 'Длинное описание. '.repeat(20),
  genres: [{ name: 'Adventure', russian: 'Приключения' }],
  studios: [{ name: 'Madhouse', imageUrl: null }],
  poster: { mainUrl: 'https://i.imgur.com/main.jpg', previewUrl: 'https://i.imgur.com/preview.jpg' },
};

describe('команда info', () => {
  test('по id вызывает animeById', async () => {
    const services = {
      shikimori: {
        search: async () => [],
        top: async () => [],
        animeById: async () => details,
      },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('info'), { args: { target: '52991' }, services });
    expect(result.kind).toBe('embed');
  });

  test('по названию ищет id, затем берёт полную карточку', async () => {
    const services = {
      shikimori: {
        search: async (q: string) => {
          expect(q).toBe('Фрирен');
          return [{ id: 52991, name: 'Sousou no Frieren', russian: 'Фрирен', kind: 'tv', status: 'released', score: 9.1, episodes: 28, url: 'https://shikimori.one/animes/52991', airedOn: '2023-09-29', poster: null }];
        },
        top: async () => [],
        animeById: async (id: number) => {
          expect(id).toBe(52991);
          return details;
        },
      },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('info'), { args: { target: 'Фрирен' }, services });
    expect(result.kind).toBe('embed');
  });

  test('не найдено → «Аниме не найдено»', async () => {
    const services = {
      shikimori: { search: async () => [], top: async () => [], animeById: async () => null },
      weather: weatherStub,
    };
    const result = await runHandler(findHandler('info'), { args: { target: 'zzz' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toBe('Аниме не найдено.');
  });
});
