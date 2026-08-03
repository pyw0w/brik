import { describe, expect, test } from 'bun:test';
import { ApplicationCommandOptionType } from 'discord.js';
import { arg, defineHandler } from '../index.ts';
import { toSlashCommand } from './registrar.ts';

describe('toSlashCommand', () => {
  test('имя и описание', () => {
    const json = toSlashCommand(
      defineHandler({ name: 'roll', description: 'Бросок кубика', run: () => ({ kind: 'message', content: 'x' }) }),
    ).toJSON();
    expect(json.name).toBe('roll');
    expect(json.description).toBe('Бросок кубика');
  });

  test('маппит типы аргументов', () => {
    const json = toSlashCommand(
      defineHandler({
        name: 'demo',
        description: 'Демо',
        args: {
          s: arg.string('строка'),
          i: arg.integer('целое'),
          n: arg.number('число'),
          b: arg.boolean('булево'),
        },
        run: () => ({ kind: 'message', content: 'x' }),
      }),
    ).toJSON();
    const types = new Set((json.options ?? []).map((o) => o.type));
    expect(types).toEqual(
      new Set([
        ApplicationCommandOptionType.String,
        ApplicationCommandOptionType.Integer,
        ApplicationCommandOptionType.Number,
        ApplicationCommandOptionType.Boolean,
      ]),
    );
  });

  test('required и choices', () => {
    const json = toSlashCommand(
      defineHandler({
        name: 'pick',
        description: 'Выбор',
        args: {
          side: arg.enum('Сторона', ['heads', 'tails']),
          count: arg.integer('Число'),
        },
        run: () => ({ kind: 'message', content: 'x' }),
      }),
    ).toJSON();
    const side = (json.options ?? []).find((o) => o.name === 'side');
    const count = (json.options ?? []).find((o) => o.name === 'count');
    expect(side?.required).toBe(true);
    if (side && 'choices' in side) {
      expect(side.choices).toEqual([
        { name: 'heads', value: 'heads' },
        { name: 'tails', value: 'tails' },
      ]);
    }
    expect(count?.required).toBe(true);
  });

  test('default-аргумент помечается необязательным', () => {
    const json = toSlashCommand(
      defineHandler({
        name: 'r',
        description: 'р',
        args: { dice: arg.string('формула').default('2d6') },
        run: () => ({ kind: 'message', content: 'x' }),
      }),
    ).toJSON();
    expect((json.options ?? [])[0]?.required).toBe(false);
  });
});
