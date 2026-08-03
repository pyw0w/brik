import { z } from 'zod';
import { defineService } from '../../core/index.ts';

export interface WeatherApi {
  now(city: string): Promise<string>;
}

declare module '../../core/index.ts' {
  interface ServiceMap {
    weather?: WeatherApi;
  }
}

export default defineService<{ apiKey?: string }>({
  name: 'weather',
  description: 'Демо-сервис погоды (эмуляция внешнего API)',
  optionsSchema: z.object({ apiKey: z.string().optional() }),
  init: ({ options, logger }) => {
    logger.info(`weather: init (apiKey=${options.apiKey ? 'задан' : 'не задан'})`);
    return {
      async now(city) {
        const base = options.apiKey?.length ?? 3;
        return `В городе ${city} сейчас +${base * 3}°C (демо)`;
      },
    } satisfies WeatherApi;
  },
});
