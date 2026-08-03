import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль ping', () => {
  test('отвечает «Понг!»', async () => {
    const handler = module.handlers.find((h) => h.name === 'ping')!;
    const result = await runHandler(handler, { args: {} });
    expect(result).toEqual({ kind: 'message', content: 'Понг!' });
  });
});
