import { arg, defineHandler, defineModule } from '../../core/index.ts';

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
      run: async ({ args }) => {
        const parsed = parseDice(args.dice);
        if (!parsed) {
          return {
            kind: 'message',
            content: `Не понял формулу «${args.dice}». Пример: /roll 2d6`,
            ephemeral: true,
          };
        }
        const results = Array.from(
          { length: parsed.count },
          () => 1 + Math.floor(Math.random() * parsed.sides),
        );
        const total = results.reduce((a, b) => a + b, 0);
        return {
          kind: 'message',
          content: `🎲 ${parsed.count}d${parsed.sides} → [${results.join(', ')}] = **${total}**`,
        };
      },
    }),
  ],
});

function parseDice(formula: string): { count: number; sides: number } | null {
  const match = /^(\d*)d(\d+)$/i.exec(formula.trim());
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2] ?? '', 10);
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
  return { count, sides };
}
