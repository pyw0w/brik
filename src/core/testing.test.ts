import { describe, expect, test } from 'bun:test';
import { createContext, runHandler } from './testing.ts';
import { defineHandler } from './index.ts';

describe('testing helpers и services', () => {
  test('createContext даёт пустой services', () => {
    expect(createContext().services).toEqual({});
  });

  test('runHandler пробрасывает services в run', async () => {
    const handler = defineHandler({
      name: 't',
      description: 't',
      run: ({ services }) => {
        const api = services as { echo?: { get(): string } };
        return { kind: 'message', content: api.echo?.get() ?? 'нет' };
      },
    });
    const result = await runHandler(handler, {
      services: { echo: { get: () => 'есть' } },
    });
    if (result.kind === 'message') expect(result.content).toBe('есть');
  });
});
