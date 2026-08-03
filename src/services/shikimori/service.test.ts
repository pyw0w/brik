import { describe, expect, test } from 'bun:test';
import shikimoriService, { ShikimoriError, type ShikimoriApi } from './service.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const baseOptions = {
  userAgent: 'Brik (Discord bot; https://github.com/pyw0w/brik)',
};

const initApi = (options: Record<string, unknown> = {}): ShikimoriApi =>
  shikimoriService.init({ options: { ...baseOptions, ...options }, logger, memory: {} } as never) as ShikimoriApi;

const okJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

const mockFetch = (impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = impl as unknown as typeof fetch;
};

const animeRaw = {
  id: '52991',
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  kind: 'tv',
  status: 'released',
  score: 9.1,
  episodes: 28,
  url: 'https://shikimori.one/animes/52991-sousou-no-frieren',
  aired_on: '2023-09-29',
  duration: 24,
  description: 'Описание аниме.',
  poster: { main_url: 'https://i.imgur.com/main.jpg', preview_url: 'https://i.imgur.com/preview.jpg' },
  genres: [{ name: 'Adventure', russian: 'Приключения' }],
  studios: [{ name: 'Madhouse', image_url: null }],
};

describe('shikimori service', () => {
  test('идентифицируется как shikimori', () => {
    expect(shikimoriService.name).toBe('shikimori');
  });

  test('search отправляет POST на endpoint с User-Agent и возвращает summary', async () => {
    let called = 0;
    mockFetch(async (url, init) => {
      called++;
      const body = JSON.parse(String(init?.body));
      expect(String(url)).toBe('https://shikimori.io/api/graphql');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe(baseOptions.userAgent);
      expect(body.variables).toEqual({ search: 'фрирен', limit: 5 });
      expect(body.query).toContain('animes');
      return okJson({ animes: [animeRaw] });
    });

    const api = initApi();
    const result = await api.search('фрирен');
    expect(called).toBe(1);
    expect(result).toEqual([
      {
        id: 52991,
        name: 'Sousou no Frieren',
        russian: 'Фрирен',
        kind: 'tv',
        status: 'released',
        score: 9.1,
        episodes: 28,
        url: 'https://shikimori.one/animes/52991-sousou-no-frieren',
        airedOn: '2023-09-29',
        poster: { mainUrl: 'https://i.imgur.com/main.jpg', previewUrl: 'https://i.imgur.com/preview.jpg' },
      },
    ]);
  });

  test('search маппит отсутствующие поля в null', async () => {
    mockFetch(async () =>
      okJson({ animes: [{ id: '1', name: 'X', url: 'https://shikimori.one/animes/1-x' }] }));
    const api = initApi();
    const result = await api.search('x');
    expect(result[0]).toEqual({
      id: 1,
      name: 'X',
      russian: null,
      kind: null,
      status: null,
      score: null,
      episodes: 0,
      url: 'https://shikimori.one/animes/1-x',
      airedOn: null,
      poster: null,
    });
  });

  test('top отправляет order=ranked и лимит', async () => {
    mockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain('order: ranked');
      expect(body.variables).toEqual({ limit: 3 });
      return okJson({ animes: [animeRaw] });
    });
    const api = initApi();
    const result = await api.top(3);
    expect(result).toHaveLength(1);
  });

  test('animeById запрашивает по ids и возвращает детали', async () => {
    mockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.variables).toEqual({ ids: '52991' });
      return okJson({ animes: [animeRaw] });
    });
    const api = initApi();
    const result = await api.animeById(52991);
    expect(result).toMatchObject({
      id: 52991,
      airedOn: '2023-09-29',
      duration: 24,
      description: 'Описание аниме.',
      genres: [{ name: 'Adventure', russian: 'Приключения' }],
      studios: [{ name: 'Madhouse', imageUrl: null }],
    });
  });

  test('animeById возвращает null для пустого ответа', async () => {
    mockFetch(async () => okJson({ animes: [] }));
    const api = initApi();
    expect(await api.animeById(1)).toBeNull();
  });

  test('не-200 статус → ShikimoriError', async () => {
    mockFetch(async () => okJson({}, 500));
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow(ShikimoriError);
  });

  test('errors[] в ответе → ShikimoriError с сообщением', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 }));
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow('boom');
  });

  test('сетевая ошибка → ShikimoriError', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow(ShikimoriError);
  });

  test('троттлинг: два запроса подряд не быстрее minRequestInterval', async () => {
    const times: number[] = [];
    mockFetch(async () => {
      times.push(performance.now());
      return okJson({ animes: [animeRaw] });
    });
    const api = initApi({ minRequestInterval: 100 });
    await api.search('a');
    await api.search('b');
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(100);
  });

  test('троттлинг: параллельные вызовы не быстрее minRequestInterval', async () => {
    const times: number[] = [];
    mockFetch(async () => {
      times.push(performance.now());
      return okJson({ animes: [animeRaw] });
    });
    const api = initApi({ minRequestInterval: 100 });
    const [a, b] = await Promise.all([api.search('a'), api.search('b')]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(100);
  });
});
