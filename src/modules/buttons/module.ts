import { arg, defineHandler, defineModule, type ComponentRow } from '../../core/index.ts';

const LIMIT = 100;

const counterRows = (): ComponentRow[] => [
  {
    buttons: [
      { id: 'step:1', label: '+1', style: 'success' },
      { id: 'step:-1', label: '−1', style: 'danger' },
      { id: 'reset', label: 'Сброс', style: 'secondary' },
    ],
  },
];

const renderCounter = (value: number) => ({
  kind: 'component' as const,
  content: `**Счётчик:** ${value}`,
  rows: counterRows(),
});

export default defineModule({
  name: 'buttons',
  description: 'Демо кнопок: счётчик с интерактивными кнопками',
  handlers: [
    defineHandler({
      name: 'counter',
      description: 'Счётчик с кнопками +1 / −1 / сброс',
      args: {
        start: arg.integer('Начальное значение').optional(),
      },
      run: async ({ args, store, input }) => {
        const value = Math.max(-LIMIT, Math.min(LIMIT, Math.trunc(args.start ?? 0)));
        await store.set(keyOf(input.author.id), value);
        return renderCounter(value);
      },
      components: [
        {
          id: 'step',
          description: '+1/−1 к счётчику (payload — шаг)',
          run: async ({ payload, store, input }) => {
            const delta = Number(payload ?? '0') || 0;
            const current = (await store.get<number>(keyOf(input.author.id))) ?? 0;
            const next = Math.max(-LIMIT, Math.min(LIMIT, current + delta));
            await store.set(keyOf(input.author.id), next);
            return { kind: 'update', result: renderCounter(next) };
          },
        },
        {
          id: 'reset',
          description: 'Сбрасывает счётчик',
          run: async ({ store, input }) => {
            await store.set(keyOf(input.author.id), 0);
            return { kind: 'update', result: renderCounter(0) };
          },
        },
      ],
    }),
  ],
});

const keyOf = (authorId: string): string => `counter:${authorId}`;
