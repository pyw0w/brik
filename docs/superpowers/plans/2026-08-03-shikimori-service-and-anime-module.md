# Shikimori Service + Anime Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить сервис `shikimori` (типизированный GraphQL-клиент к Shikimori) и модуль `anime` с командами `/anime search`, `/anime top`, `/anime info`.

**Architecture:** Сервис в `src/services/shikimori/service.ts` — тонкий GraphQL-клиент на `fetch` без новых зависимостей: три метода (`search`, `top`, `animeById`), обязательный `User-Agent`, троттлинг между запросами, ошибки `ShikimoriError`. Модуль в `src/modules/anime/module.ts` декларирует `services: ['shikimori']` и рендерит результаты в embed-результаты. Модуль импортирует только core-фасад и потому обрабатывает ошибки сервиса через generic try/catch.

**Tech Stack:** TypeScript, bun (test runner), zod (схема опций), discord.js типы `EmbedData` (только тип в Result), `global fetch` (bun).

## Global Constraints

- Команды и типы в bun: `bun test`, `bun run typecheck`, `bun run check:boundaries`, `bun run docs:build`, `bun run test:coverage` (порог 0.7).
- Границы (check:boundaries): модули и сервисы импортируют только `../../core/index.ts` (код) и `../../core/testing.ts` (тесты); сервис/модуль не должны импортировать `discord.js`, `src/core/internal/**`, `src/core/discord/**`, `src/app/**` и не должны импортировать друг друга (модуль не импортирует `../../services/shikimori/service.ts`).
- API Shikimori: эндпоинт `POST https://shikimori.io/api/graphql`, body `{ query, variables }`, `Content-Type: application/json`; обязателен заголовок `User-Agent`; лимиты 5 rps / 90 rpm; `animes` поддерживает `search`, `order: 'ranked'`, `limit` (max 50), `page`, `ids`.
- Поля GraphQL (snake_case): `animes { id name russian kind status score episodes url aired_on duration description poster { main_url preview_url } genres { name russian } studios { name image_url } }`.
- Комментарии, сообщения об ошибках и пользовательские тексты — на русском; идентификаторы/типы — английские.
- Доменные типы должны быть null-tolerant (поля могут отсутствовать).

---

### Task 1: Сервис `shikimori`

**Files:**
- Create: `src/services/shikimori/service.ts`
- Test: `src/services/shikimori/service.test.ts`

**Interfaces:**
- Consumes: `defineService`, `ServiceInitContext` из `../../core/index.ts`.
- Produces: экспорт `AnimeSummary`, `AnimeDetails`, `ShikimoriApi`, `ShikimoriError`; default export сервис с `name: 'shikimori'`; аугментация `declare module '../../core/index.ts' { interface ServiceMap { shikimori: ShikimoriApi } }`.

- [ ] **Step 1: Write the failing test**

Create `src/services/shikimori/service.test.ts`:

```ts
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
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      called++;
      const body = JSON.parse(String(init?.body));
      expect(String(url)).toBe('https://shikimori.io/api/graphql');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe(baseOptions.userAgent);
      expect(body.variables).toEqual({ search: 'фрирен', limit: 5 });
      expect(body.query).toContain('animes');
      return okJson({ animes: [animeRaw] });
    };

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
        poster: { mainUrl: 'https://i.imgur.com/main.jpg', previewUrl: 'https://i.imgur.com/preview.jpg' },
      },
    ]);
  });

  test('search маппит отсутствующие поля в null', async () => {
    globalThis.fetch = async () =>
      okJson({ animes: [{ id: '1', name: 'X', url: 'https://shikimori.one/animes/1-x' }] });
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
      poster: null,
    });
  });

  test('top отправляет order=ranked и лимит', async () => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain('order: ranked');
      expect(body.variables).toEqual({ limit: 3 });
      return okJson({ animes: [animeRaw] });
    };
    const api = initApi();
    const result = await api.top(3);
    expect(result).toHaveLength(1);
  });

  test('animeById запрашивает по ids и возвращает детали', async () => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.variables).toEqual({ ids: '52991' });
      return okJson({ animes: [animeRaw] });
    };
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
    globalThis.fetch = async () => okJson({ animes: [] });
    const api = initApi();
    expect(await api.animeById(1)).toBeNull();
  });

  test('не-200 статус → ShikimoriError', async () => {
    globalThis.fetch = async () => okJson({}, 500);
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow(ShikimoriError);
  });

  test('errors[] в ответе → ShikimoriError с сообщением', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 });
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow('boom');
  });

  test('сетевая ошибка → ShikimoriError', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const api = initApi();
    await expect(api.search('x')).rejects.toThrow(ShikimoriError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/shikimori/service.test.ts -v`
Expected: FAIL — «Cannot find module './service.ts'» (файл не создан).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/shikimori/service.ts`:

```ts
import { z } from 'zod';
import { defineService } from '../../core/index.ts';

export class ShikimoriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShikimoriError';
  }
}

export interface AnimeSummary {
  id: number;
  name: string;
  russian: string | null;
  kind: string | null;
  status: string | null;
  score: number | null;
  episodes: number;
  url: string;
  poster: { mainUrl: string; previewUrl: string } | null;
}

export interface AnimeDetails extends AnimeSummary {
  airedOn: string | null;
  genres: { name: string; russian: string | null }[];
  description: string | null;
  studios: { name: string; imageUrl: string | null }[];
  duration: number | null;
}

export interface ShikimoriApi {
  search(query: string, limit?: number): Promise<AnimeSummary[]>;
  top(limit?: number): Promise<AnimeSummary[]>;
  animeById(id: number): Promise<AnimeDetails | null>;
}

declare module '../../core/index.ts' {
  interface ServiceMap {
    shikimori: ShikimoriApi;
  }
}

const SUMMARY_FIELDS = `
  id
  name
  russian
  kind
  status
  score
  episodes
  url
  poster {
    main_url
    preview_url
  }
`;

const SEARCH_QUERY = `query SearchAnimes($search: String, $limit: PositiveInt) {
  animes(search: $search, limit: $limit, order: ranked) {
    ${SUMMARY_FIELDS}
  }
}`;

const TOP_QUERY = `query TopAnimes($limit: PositiveInt) {
  animes(limit: $limit, order: ranked) {
    ${SUMMARY_FIELDS}
  }
}`;

const INFO_QUERY = `query AnimeInfo($ids: String) {
  animes(ids: $ids, limit: 1) {
    ${SUMMARY_FIELDS}
    aired_on
    duration
    description
    genres {
      name
      russian
    }
    studios {
      name
      image_url
    }
  }
}`;

const clampLimit = (n: number | undefined, max: number): number =>
  Math.max(1, Math.min(Math.trunc(n ?? 5), max));

interface AnimeRaw {
  id: string | number;
  name?: string;
  russian?: string | null;
  kind?: string | null;
  status?: string | null;
  score?: number | null;
  episodes?: number | null;
  url?: string;
  poster?: { main_url?: string; preview_url?: string } | null;
  aired_on?: string | null;
  duration?: number | null;
  description?: string | null;
  genres?: { name?: string; russian?: string | null }[] | null;
  studios?: { name?: string; image_url?: string | null }[] | null;
}

interface GraphqlEnvelope {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

export default defineService<{
  userAgent: string;
  endpoint?: string;
  minRequestInterval?: number;
}>({
  name: 'shikimori',
  description: 'Клиент GraphQL-API Shikimori (поиск и просмотр аниме)',
  optionsSchema: z.object({
    userAgent: z.string().min(1),
    endpoint: z.string().url().optional().default('https://shikimori.io/api/graphql'),
    minRequestInterval: z.number().min(50).max(5000).optional().default(200),
  }),
  init: ({ options, logger }) => {
    const endpoint = options.endpoint;
    const interval = options.minRequestInterval;
    let lastRequestAt = 0;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    async function request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const now = Date.now();
      const wait = Math.max(0, lastRequestAt + interval - now);
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': options.userAgent,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch {
        throw new ShikimoriError('Не удалось связаться с Shikimori');
      }

      if (!res.ok) throw new ShikimoriError(`Shikimori: HTTP ${res.status}`);

      const json = (await res.json()) as GraphqlEnvelope;
      if (json.errors && json.errors.length > 0) {
        throw new ShikimoriError(`Shikimori: ${json.errors[0].message}`);
      }
      return json.data as T;
    }

    const mapSummary = (raw: AnimeRaw): AnimeSummary => ({
      id: Number(raw.id),
      name: raw.name ?? '',
      russian: raw.russian ?? null,
      kind: raw.kind ?? null,
      status: raw.status ?? null,
      score: raw.score ?? null,
      episodes: raw.episodes ?? 0,
      url: raw.url ?? '',
      poster: raw.poster?.main_url ? { mainUrl: raw.poster.main_url, previewUrl: raw.poster.preview_url ?? raw.poster.main_url } : null,
    });

    return {
      async search(query, limit = 5) {
        const n = clampLimit(limit, 10);
        logger.debug(`shikimori: search "${query}" limit=${n}`);
        const data = await request<{ animes: AnimeRaw[] }>(SEARCH_QUERY, { search: query, limit: n });
        return (data.animes ?? []).map(mapSummary);
      },
      async top(limit = 5) {
        const n = clampLimit(limit, 10);
        logger.debug(`shikimori: top limit=${n}`);
        const data = await request<{ animes: AnimeRaw[] }>(TOP_QUERY, { limit: n });
        return (data.animes ?? []).map(mapSummary);
      },
      async animeById(id) {
        logger.debug(`shikimori: animeById ${id}`);
        const data = await request<{ animes: AnimeRaw[] }>(INFO_QUERY, { ids: String(id) });
        const raw = data.animes?.[0];
        if (!raw) return null;
        return {
          ...mapSummary(raw),
          airedOn: raw.aired_on ?? null,
          duration: raw.duration ?? null,
          description: raw.description ?? null,
          genres: (raw.genres ?? []).map((g) => ({ name: g.name ?? '', russian: g.russian ?? null })),
          studios: (raw.studios ?? []).map((s) => ({ name: s.name ?? '', imageUrl: s.image_url ?? null })),
        };
      },
    } satisfies ShikimoriApi;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/shikimori/service.test.ts -v`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/shikimori/service.ts src/services/shikimori/service.test.ts
git commit -m "feat(services): shikimori GraphQL client service"
```

---

### Task 2: Модуль `anime` — команды search и top

**Files:**
- Create: `src/modules/anime/module.ts`
- Test: `src/modules/anime/module.test.ts`

**Interfaces:**
- Consumes: `arg`, `defineHandler`, `defineModule` из `../../core/index.ts`; `runHandler` из `../../core/testing.ts`; сервис `shikimori` (типизирован через `services: ['shikimori'] as const` — доступ к `ShikimoriApi` из Task 1, но без прямого импорта).
- Produces: default export модуля `anime` с handlers `search`, `top` (и `info` в Task 3).

- [ ] **Step 1: Write the failing test**

Create `src/modules/anime/module.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';
import type { AnimeSummary, ShikimoriApi } from '../../services/shikimori/service.ts';

const summary = (over: Partial<AnimeSummary> = {}): AnimeSummary => ({
  id: 52991,
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  kind: 'tv',
  status: 'released',
  score: 9.1,
  episodes: 28,
  url: 'https://shikimori.one/animes/52991',
  poster: null,
  ...over,
});

const makeServices = (over: Partial<ShikimoriApi> = {}): { shikimori: ShikimoriApi } => ({
  shikimori: {
    search: async () => [],
    top: async () => [],
    animeById: async () => null,
    ...over,
  },
});

const findHandler = (name: string) => module.handlers.find((h) => h.name === name)!;

describe('модуль anime', () => {
  test('search возвращает список результатов', async () => {
    const services = makeServices({ search: async () => [summary(), summary({ id: 2, name: 'Naruto', russian: null, score: 8.5 })] });
    const result = await runHandler(findHandler('search'), { args: { query: 'фрирен', limit: 2 }, services });
    expect(result.kind).toBe('embed');
  });

  test('search с пустым результатом пишет «Ничего не найдено»', async () => {
    const services = makeServices();
    const result = await runHandler(findHandler('search'), { args: { query: 'zzz' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toContain('Ничего не найдено');
  });

  test('search дефолтный limit = 5', async () => {
    let requestedLimit: number | undefined;
    const services = makeServices({
      search: async (_q, limit) => {
        requestedLimit = limit;
        return [summary()];
      },
    });
    await runHandler(findHandler('search'), { args: { query: 'x' }, services });
    expect(requestedLimit).toBe(5);
  });

  test('top возвращает список', async () => {
    const services = makeServices({ top: async () => [summary(), summary({ id: 3, name: 'AoT', russian: 'Атака титанов' })] });
    const result = await runHandler(findHandler('top'), { args: { limit: 2 }, services });
    expect(result.kind).toBe('embed');
  });

  test('ошибка сервиса → дружелюбный текст', async () => {
    const services = makeServices({ search: async () => { throw new Error('boom'); } });
    const result = await runHandler(findHandler('search'), { args: { query: 'x' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toContain('Не удалось получить данные от Shikimori');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/anime/module.test.ts -v`
Expected: FAIL — «Cannot find module './module.ts'».

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/anime/module.ts`:

```ts
import { arg, defineHandler, defineModule } from '../../core/index.ts';
import type { AnimeSummary } from '../../services/shikimori/service.ts';
```

**Остановитесь здесь.** Модуль **не может** импортировать `../../services/shikimori/service.ts` — это нарушение границ (`check:boundaries` пропускает только `../../core/*`). Типизация `ctx.services.shikimori` приходит из аугментации `ServiceMap`, поэтому импорт типов из сервиса не нужен.

Вместо этого напишите модуль так:

```ts
import { arg, defineHandler, defineModule } from '../../core/index.ts';

const clampLimit = (n: number | undefined): number => Math.max(1, Math.min(Math.trunc(n ?? 5), 10));

const formatYear = (airedOn: string | null): string => (airedOn ? ` ${airedOn.slice(0, 4)}` : '');

const formatSummaryLine = (item: { russian: string | null; name: string; score: number | null; airedOn: string | null }, i: number): string => {
  const title = item.russian ?? item.name;
  const meta = [item.score !== null ? `оценка ${item.score}` : null, item.airedOn ? item.airedOn.slice(0, 4) : null]
    .filter(Boolean)
    .join(' · ');
  return `${i}. **${title}**${meta ? ` — ${meta}` : ''}`;
};

const renderList = (items: Array<{ russian: string | null; name: string; score: number | null; airedOn: string | null }>, title: string) => ({
  kind: 'embed' as const,
  embed: {
    title,
    description: items.map(formatSummaryLine).join('\n'),
    color: 0x2e7df6,
  },
});

export default defineModule({
  name: 'anime',
  description: 'Поиск аниме через Shikimori',
  services: ['shikimori'] as const,
  handlers: [
    defineHandler({
      name: 'search',
      description: 'Поиск аниме по названию',
      args: {
        query: arg.string('Название аниме'),
        limit: arg.integer('Сколько показать (1–10)').optional(),
      },
      run: async ({ services, args }) => {
        try {
          const results = await services.shikimori.search(args.query, args.limit);
          if (results.length === 0) return { kind: 'message', content: `Ничего не найдено по запросу «${args.query}».` };
          return renderList(results, `Поиск: ${args.query}`);
        } catch {
          return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
        }
      },
    }),
    defineHandler({
      name: 'top',
      description: 'Топ аниме по рейтингу',
      args: {
        limit: arg.integer('Сколько показать (1–10)').optional(),
      },
      run: async ({ services, args }) => {
        try {
          const results = await services.shikimori.top(args.limit);
          if (results.length === 0) return { kind: 'message', content: 'Топ пуст.' };
          return renderList(results, 'Топ аниме по рейтингу');
        } catch {
          return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
        }
      },
    }),
  ],
});
```

**Замечание:** `services.shikimori` типизируется как `ShikimoriApi` через аугментацию `ServiceMap` (Task 1), поэтому `results` — `AnimeSummary[]` с полями `russian`, `name`, `score`, `airedOn`. Импорт `type { AnimeSummary }` из сервиса в шапке выше — это только подсказка; в реальном файле его быть не должно (нарушение границ). Проверьте: в финальном файле НЕ должно быть `import ... from '../../services/shikimori/service.ts'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/modules/anime/module.test.ts -v`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/modules/anime/module.ts src/modules/anime/module.test.ts
git commit -m "feat(modules): anime search/top commands"
```

---

### Task 3: Команда `info` в модуле anime

**Files:**
- Modify: `src/modules/anime/module.ts`
- Test: `src/modules/anime/module.test.ts`

**Interfaces:**
- Consumes: `arg` из core; `services.shikimori.search`/`animeById` (Task 1).
- Produces: handler `info` — принимает `id|название`, возвращает embed-карточку.

- [ ] **Step 1: Write the failing test**

Добавьте в конец `src/modules/anime/module.test.ts`:

```ts
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
    const services = makeServices({ animeById: async () => details });
    const result = await runHandler(findHandler('info'), { args: { target: '52991' }, services });
    expect(result.kind).toBe('embed');
  });

  test('по названию ищет и берёт первый результат', async () => {
    const services = makeServices({
      search: async (q) => {
        expect(q).toBe('Фрирен');
        return [details];
      },
    });
    const result = await runHandler(findHandler('info'), { args: { target: 'Фрирен' }, services });
    expect(result.kind).toBe('embed');
  });

  test('не найдено → «Аниме не найдено»', async () => {
    const services = makeServices();
    const result = await runHandler(findHandler('info'), { args: { target: 'zzz' }, services });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toBe('Аниме не найдено.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/anime/module.test.ts -v`
Expected: FAIL — `Cannot read properties of undefined (reading 'find')` (handler `info` не найден).

- [ ] **Step 3: Write minimal implementation**

Добавьте в `src/modules/anime/module.ts` константы подписей и третий handler. Сначала — константы (вставить перед `export default defineModule`):

```ts
const KIND_LABELS: Record<string, string> = {
  tv: 'ТВ сериал',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спецвыпуск',
};

const STATUS_LABELS: Record<string, string> = {
  released: 'вышел',
  ongoing: 'онгоинг',
  announced: 'анонсирован',
};

const labelOf = (table: Record<string, string>, key: string | null): string | null =>
  key ? (table[key] ?? key) : null;

const truncate = (text: string | null, max: number): string | null => {
  if (!text) return null;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
};

const renderInfo = (item: AnimeDetailsLike) => {
  const title = item.russian ? `${item.russian} (${item.name})` : item.name;
  const kind = labelOf(KIND_LABELS, item.kind);
  const status = labelOf(STATUS_LABELS, item.status);
  const year = item.airedOn ? item.airedOn.slice(0, 4) : null;
  const genres = item.genres.map((g) => g.russian ?? g.name).slice(0, 5).join(', ');
  const description = truncate(item.description, 200);

  return {
    kind: 'embed' as const,
    embed: {
      title,
      url: item.url,
      thumbnail: item.poster?.mainUrl,
      color: 0x2e7df6,
      fields: [
        ...[kind ? { name: 'Тип', value: kind, inline: true } : []],
        ...[status ? { name: 'Статус', value: status, inline: true } : []],
        ...[item.score !== null ? { name: 'Оценка', value: String(item.score), inline: true } : []],
        ...[item.episodes ? { name: 'Эпизоды', value: String(item.episodes), inline: true } : []],
        ...[year ? { name: 'Год', value: year, inline: true } : []],
        ...[genres ? { name: 'Жанры', value: genres } : []],
      ],
      description: description ?? undefined,
    },
  };
};
```

Вставьте перед `export default defineModule` тип для карточки (чтобы не зависеть от сервиса):

```ts
interface AnimeDetailsLike {
  name: string;
  russian: string | null;
  kind: string | null;
  status: string | null;
  score: number | null;
  episodes: number;
  url: string;
  airedOn: string | null;
  genres: { name: string; russian: string | null }[];
  poster: { mainUrl: string; previewUrl: string } | null;
}
```

Добавьте третий handler в массив `handlers`:

```ts
defineHandler({
  name: 'info',
  description: 'Карточка аниме по id или названию',
  args: {
    target: arg.string('ID или название аниме'),
  },
  run: async ({ services, args }) => {
    try {
      const isId = /^\d+$/.test(args.target);
      let item: AnimeDetailsLike | null = null;
      if (isId) {
        item = await services.shikimori.animeById(Number(args.target));
      } else {
        const results = await services.shikimori.search(args.target, 1);
        item = results[0] ?? null;
      }
      if (!item) return { kind: 'message', content: 'Аниме не найдено.' };
      return renderInfo(item);
    } catch {
      return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
    }
  },
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/modules/anime/module.test.ts -v`
Expected: PASS (8 тестов).

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS. Убедитесь, что `renderInfo` принимает `AnimeDetailsLike`, иначе неявный any.

- [ ] **Step 6: Commit**

```bash
git add src/modules/anime/module.ts src/modules/anime/module.test.ts
git commit -m "feat(modules): anime info command"
```

---

### Task 4: Включение в конфиг и интеграционная проверка

**Files:**
- Modify: `bot.config.ts`
- Test: (нет новых тестов; интеграция через существующие проверки)

**Interfaces:**
- Consumes: сервис `shikimori` (Task 1), модуль `anime` (Tasks 2–3).

- [ ] **Step 1: Включить сервис и модуль в конфиг**

Измените `bot.config.ts`:

```ts
export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
    forecast: { enabled: true },
    anime: { enabled: true },
  },
  services: {
    shikimori: {
      options: {
        userAgent: process.env.SHIKIMORI_USER_AGENT ?? 'Brik (Discord bot; https://github.com/pyw0w/brik)',
      },
    },
  },
  owners: [],
} satisfies BotConfig;
```

- [ ] **Step 2: Проверить, что конфиг типизируется и сервис строится**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun test`
Expected: PASS (все существующие + новые тесты).

- [ ] **Step 3: Проверить границы**

Run: `bun run check:boundaries`
Expected: PASS — «Границы ок: 12 файлов модулей и сервисов» (было 10, добавились service.ts + module.ts).

- [ ] **Step 4: Проверить покрытие**

Run: `bun run test:coverage`
Expected: покрытие ≥ 0.7 (порог). Если `test:coverage` падает из-за известного бага bun 1.3.11 (interactor /boom пишет ERROR в stderr), это предсуществующая проблема, не связанная с этой фичей — зафиксируйте и переходите дальше.

- [ ] **Step 5: Обновить docs**

В `docs/guides/module-api.md` (после примера weather/forecast) добавить упоминание, что примеры сервисов можно посмотреть в `src/services/shikimori` (GraphQL-клиент с User-Agent и троттлингом). Точный diff не требуется — короткий абзац.

- [ ] **Step 6: Обновить генератор**

Проверьте, что `bun run create:service shikimori` не требуется (сервис уже создан вручную). В `AGENTS.md` и `docs/llm.md` секции про сервисы уже есть — новый сервис добавлять не нужно (они описывают инфраструктуру, не конкретные сервисы).

- [ ] **Step 7: Коммит**

```bash
git add bot.config.ts docs/guides/module-api.md
git commit -m "feat(config): enable anime module and shikimori service"
```

- [ ] **Step 8: Финальные проверки**

Run: `bun test && bun run typecheck && bun run check:boundaries && bun run docs:build`
Expected: все PASS.

---

### Task 5: Полное ревью (review всех коммитов фичи)

**Files:**
- (нет изменений кода; только проверка)

**Interfaces:**
- Consumes: все задачи 1–4.

- [ ] **Step 1: Проверить тесты**

Run: `bun test`
Expected: PASS.

- [ ] **Step 2: Проверить границы и типы**

Run: `bun run typecheck && bun run check:boundaries`
Expected: PASS.

- [ ] **Step 3: Проверить покрытие**

Run: `bun run test:coverage`
Expected: ≥ 0.7; сравнить с базой (было 96.48%).

- [ ] **Step 4: Проверить, что нет нелегальных импортов**

Run: `rg "services/shikimori/service" src/modules/anime` 
Expected: пусто (модуль не импортирует сервис).

Run: `rg "discord.js|core/internal|core/discord" src/modules/anime src/services/shikimori`
Expected: пусто.

- [ ] **Step 5: Прогнать check:boundaries**

Run: `bun run check:boundaries`
Expected: PASS.

---

## Self-Review

**Spec coverage:**
- Сервис `shikimori` (search/top/animeById, User-Agent, троттлинг, ShikimoriError, null-tolerant маппинг) → Task 1.
- Модуль `anime` (search, top, info; embed-списки; карточка с постером и подписями; friendly-ошибка) → Tasks 2–3.
- Опции (userAgent required, endpoint default, minRequestInterval default) → Task 1.
- Границы (модуль не импортирует сервис) → Task 2 (явное замечание) + Task 5 (rg-проверка).
- Конфиг + docs → Task 4.
- Тесты: сервис (маппинг, ошибки, URL/headers) и модуль (пустой/непустой, default limit, friendly-ошибка, info по id/названию) → Tasks 1–3.

**Placeholder scan:** нет TBD/TODO; каждый код-шаг содержит полный код. Единственное замечание — Task 2 шаг 3 содержит «стоп» с объяснением границ, это намеренная защита, а не плейсхолдер.

**Type consistency:**
- `AnimeSummary` (Task 1) → используется в `renderList` (Task 2), поля `russian/name/score/airedOn` совпадают.
- `AnimeDetailsLike` (Task 3) — локальный структурный тип в модуле, совместим с `AnimeDetails` из сервиса (поля совпадают).
- `renderInfo` принимает `AnimeDetailsLike`, `services.shikimori.animeById` возвращает `AnimeDetails | null` — структурно совместимо.
- `clampLimit` в сервисе (max 10) и в модуле (max 10) — согласованы.
