import { defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: 'ping',
  description: 'Проверка связи с ботом',
  handlers: [
    defineHandler({
      name: 'ping',
      description: 'Отвечает «Понг!»',
      run: () => ({ kind: 'message', content: 'Понг!' }),
    }),
  ],
});
