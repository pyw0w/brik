import { describe, expect, test } from 'bun:test';
import { defineService, type ServiceMap } from './index.ts';

describe('defineService', () => {
  test('сохраняет name/description/init и возвращает api из init', () => {
    const svc = defineService<{ url: string }>({
      name: 'echo',
      description: 'Тестовый сервис',
      init: ({ options }) => ({ url: options.url }),
      close: () => {},
    });
    expect(svc.name).toBe('echo');
    expect(svc.description).toBe('Тестовый сервис');
    const api = svc.init({ options: { url: 'https://x' }, logger: {} as never, memory: {} as never });
    expect(api).toEqual({ url: 'https://x' });
  });

  test('close опционален', () => {
    const svc = defineService({ name: 'noop', init: () => 42 });
    expect(svc.close).toBeUndefined();
    expect(svc.init({ options: undefined, logger: {} as never, memory: {} as never })).toBe(42);
  });

  test('ServiceMap пуст без сервисов', () => {
    const map: ServiceMap = {};
    expect(Object.keys(map)).toEqual([]);
  });
});
