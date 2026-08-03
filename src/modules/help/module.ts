import { defineHandler, defineModule, type CommandCatalog } from '../../core/index.ts';

let commands: CommandCatalog;

export default defineModule({
  name: 'help',
  description: 'Показывает список всех команд бота',
  setup: (ctx) => {
    commands = ctx.commands;
  },
  handlers: [
    defineHandler({
      name: 'help',
      description: 'Показывает список всех команд',
      run: () => {
        const list = commands.list();
        if (list.length === 0) {
          return { kind: 'message', content: 'Команд пока нет.' };
        }
        const lines = list.map((c) => `/${c.name} — ${c.description}`).sort();
        return { kind: 'message', content: `**Команды:**\n${lines.join('\n')}` };
      },
    }),
  ],
});
