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
  const meta = [item.score !== null ? `оценка ${item.score}` : null, item.airedOn ? item.airedOn.slice(0, 4) : null]
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
          const results = await services.shikimori.search(args.query, clampLimit(args.limit));
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
          const results = await services.shikimori.top(clampLimit(args.limit));
          if (results.length === 0) return { kind: 'message', content: 'Топ пуст.' };
          return renderList(results, 'Топ аниме по рейтингу');
        } catch {
          return { kind: 'message', content: 'Не удалось получить данные от Shikimori. Попробуйте позже.' };
        }
      },
    }),
  ],
});
