import { arg, defineHandler, defineModule } from '../../core/index.ts';

const clampLimit = (n: number | undefined): number => Math.max(1, Math.min(Math.trunc(n ?? 5), 10));

interface ListItem {
  russian: string | null;
  name: string;
  score: number | null;
  airedOn: string | null;
}

const formatSummaryLine = (item: ListItem, i: number): string => {
  const title = item.russian ?? item.name;
  const meta = [item.score ? `оценка ${item.score}` : null, item.airedOn ? item.airedOn.slice(0, 4) : null]
    .filter(Boolean)
    .join(' · ');
  return `${i + 1}. **${title}**${meta ? ` — ${meta}` : ''}`;
};

const renderList = (items: ListItem[], title: string) => ({
  kind: 'embed' as const,
  embed: {
    title,
    description: items.map(formatSummaryLine).join('\n'),
    color: 0x2e7df6,
  },
});

interface AnimeDetailsLike {
  name: string;
  russian: string | null;
  kind: string | null;
  status: string | null;
  score: number | null;
  episodes: number;
  url: string;
  airedOn: string | null;
  description: string | null;
  genres: { name: string; russian: string | null }[];
  poster: { mainUrl: string; previewUrl: string } | null;
}

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

  const fields: { name: string; value: string; inline?: boolean }[] = [
    ...(kind ? [{ name: 'Тип', value: kind, inline: true }] : []),
    ...(status ? [{ name: 'Статус', value: status, inline: true }] : []),
    ...(item.score ? [{ name: 'Оценка', value: String(item.score), inline: true }] : []),
    ...(item.episodes ? [{ name: 'Эпизоды', value: String(item.episodes), inline: true }] : []),
    ...(year ? [{ name: 'Год', value: year, inline: true }] : []),
    ...(genres ? [{ name: 'Жанры', value: genres }] : []),
  ];

  return {
    kind: 'embed' as const,
    embed: {
      title,
      url: item.url,
      ...(item.poster ? { thumbnail: { url: item.poster.mainUrl } } : {}),
      color: 0x2e7df6,
      fields,
      ...(description ? { description } : {}),
    },
  };
};

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
      run: async ({ services, args, logger }) => {
        try {
          const results = await services.shikimori.search(args.query, clampLimit(args.limit));
          if (results.length === 0) return { kind: 'message', content: `Ничего не найдено по запросу «${args.query}».` };
          return renderList(results, `Поиск: ${args.query}`);
        } catch (error) {
          logger.error('anime: ошибка Shikimori', error);
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
      run: async ({ services, args, logger }) => {
        try {
          const results = await services.shikimori.top(clampLimit(args.limit));
          if (results.length === 0) return { kind: 'message', content: 'Топ пуст.' };
          return renderList(results, 'Топ аниме по рейтингу');
        } catch (error) {
          logger.error('anime: ошибка Shikimori', error);
          return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
        }
      },
    }),
    defineHandler({
      name: 'info',
      description: 'Карточка аниме по id или названию',
      args: {
        target: arg.string('ID или название аниме'),
      },
      run: async ({ services, args, logger }) => {
        try {
          const isId = /^\d+$/.test(args.target);
          let item: AnimeDetailsLike | null = null;
          if (isId) {
            item = await services.shikimori.animeById(Number(args.target));
          } else {
            const results = await services.shikimori.search(args.target, 1);
            const found = results[0];
            item = found ? await services.shikimori.animeById(found.id) : null;
          }
          if (!item) return { kind: 'message', content: 'Аниме не найдено.' };
          return renderInfo(item);
        } catch (error) {
          logger.error('anime: ошибка Shikimori', error);
          return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
        }
      },
    }),
  ],
});
