import { describe, expect, test } from 'bun:test';
import { arg, parseArgs, type ArgsSchema } from './args.ts';

describe('parseArgs', () => {
  const schema = {
    dice: arg.string('Формула').default('2d6'),
    count: arg.integer('Число'),
    verbose: arg.boolean('Подробно'),
    label: arg.enum('Метка', ['heads', 'tails']),
  } satisfies ArgsSchema;

  test('применяет дефолт для отсутствующего аргумента', () => {
    const out = parseArgs(schema, { count: 3, verbose: true, label: 'heads' });
    expect(out.dice).toBe('2d6');
    expect(out.count).toBe(3);
  });

  test('парсит переданные значения', () => {
    const out = parseArgs(schema, { dice: '3d8', count: 5, verbose: true, label: 'tails' });
    expect(out).toEqual({ dice: '3d8', count: 5, verbose: true, label: 'tails' });
  });

  test('required без значения бросает', () => {
    expect(() => parseArgs(schema, { verbose: true })).toThrow();
  });

  test('невалидное значение enum бросает', () => {
    expect(() => parseArgs(schema, { count: 1, label: 'nope' })).toThrow();
  });

  test('невалидный integer бросает', () => {
    expect(() => parseArgs(schema, { count: 1.5 })).toThrow();
  });
});

describe('arg', () => {
  test('required зависит от optional/default', () => {
    expect(arg.string('обязательный').required).toBe(true);
    expect(arg.string('опц').optional().required).toBe(false);
    expect(arg.string('деф').default('x').required).toBe(false);
  });

  test('discordType — строковый тег без discord.js', () => {
    expect(arg.string('s').discordType).toBe('string');
    expect(arg.integer('i').discordType).toBe('integer');
    expect(arg.number('n').discordType).toBe('number');
    expect(arg.boolean('b').discordType).toBe('boolean');
    expect(arg.enum('e', ['a', 'b']).discordType).toBe('string');
  });

  test('choices сохраняются у enum', () => {
    expect(arg.enum('e', ['a', 'b']).choices).toEqual(['a', 'b']);
  });
});
