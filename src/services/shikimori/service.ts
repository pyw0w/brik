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
  airedOn: string | null;
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
  aired_on
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
  aired_on?: string | null;
  poster?: { main_url?: string; preview_url?: string } | null;
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
    const endpoint = options.endpoint ?? 'https://shikimori.io/api/graphql';
    const interval = options.minRequestInterval ?? 200;
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
        throw new ShikimoriError(`Shikimori: ${json.errors[0]!.message}`);
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
      airedOn: raw.aired_on ?? null,
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
