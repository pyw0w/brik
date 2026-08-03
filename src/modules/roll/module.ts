import { arg, defineHandler, defineModule, type ComponentRow } from '../../core/index.ts';

const REROLL_BUTTON: ComponentRow = {
  buttons: [{ id: 'reroll', label: '🎲 Ещё раз', style: 'primary' }],
};

export default defineModule({
  name: 'roll',
  description: 'Броски кубиков',
  handlers: [
    defineHandler({
      name: 'roll',
      description: 'Бросает кубики, например /roll 2d6',
      args: {
        dice: arg.string('Формула броска, например 2d6').default('2d6'),
      },
      run: async ({ args, store, input }) => {
        const parsed = parseDice(args.dice);
        if (!parsed) {
          return {
            kind: 'message',
            content: `Не понял формулу «${args.dice}». Пример: /roll 2d6`,
            ephemeral: true,
          };
        }
        await store.set(`last:${input.author.id}`, args.dice);
        return rollResult(parsed);
      },
      components: [
        {
          id: 'reroll',
          description: 'Бросает кубики ещё раз и обновляет сообщение',
          run: async ({ store, input }) => {
            const formula = (await store.get<string>(`last:${input.author.id}`)) ?? '2d6';
            const parsed = parseDice(formula);
            if (!parsed) {
              return { kind: 'message', content: 'Не удалось повторить бросок', ephemeral: true };
            }
            return {
              kind: 'update',
              result: rollResult(parsed),
            };
          },
        },
      ],
    }),
  ],
});

/** Роллит кубики и возвращает Result с кнопкой переброса (без kind=update — он не вкладывается). */
function rollResult(
  parsed: { count: number; sides: number },
): Exclude<import('../../core/index.ts').Result, { kind: 'update' }> {
  const results = Array.from(
    { length: parsed.count },
    () => 1 + Math.floor(Math.random() * parsed.sides),
  );
  const total = results.reduce((a, b) => a + b, 0);
  return {
    kind: 'component',
    content: `🎲 ${parsed.count}d${parsed.sides} → [${results.join(', ')}] = **${total}**`,
    rows: [REROLL_BUTTON],
  };
}

function parseDice(formula: string): { count: number; sides: number } | null {
  const match = /^(\d*)d(\d+)$/i.exec(formula.trim());
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2] ?? '', 10);
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
  return { count, sides };
}
