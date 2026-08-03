import { arg, defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: 'forecast',
  description: 'Погода через сервис weather',
  services: ['weather'],
  handlers: [
    defineHandler({
      name: 'forecast',
      description: 'Погода в городе',
      args: {
        city: arg.string('Город').default('Москва'),
      },
      run: async ({ services, args }) => {
        const text = await services.weather!.now(args.city);
        return { kind: 'message', content: text };
      },
    }),
  ],
});
