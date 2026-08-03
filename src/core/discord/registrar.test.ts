import { describe, expect, mock, test } from 'bun:test';
import { ApplicationCommandOptionType, type Client } from 'discord.js';
import { arg, defineHandler } from '../index.ts';
import { syncCommands, toSlashCommand } from './registrar.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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

describe('syncCommands', () => {
  function fakeClient(guildsFetch: unknown, appSet = mock(async () => {})): Client {
    return {
      application: { commands: { set: appSet } },
      guilds: { fetch: guildsFetch },
    } as unknown as Client;
  }

  test('гильда dev не найдена — понятная ошибка вместо Unknown Guild', async () => {
    const client = fakeClient(async () => {
      throw { code: 10004, message: 'Unknown Guild' };
    });
    await expect(syncCommands(client, [], '123', logger)).rejects.toThrow(
      /Гильда 123 не найдена/,
    );
  });

  test('ошибка без кода 10004 пробрасывается как есть', async () => {
    const client = fakeClient(async () => {
      throw new Error('boom');
    });
    await expect(syncCommands(client, [], '123', logger)).rejects.toThrow('boom');
  });

  test('dev-гильда: команды регистрируются на гильду', async () => {
    const set = mock(async () => {});
    const client = fakeClient(async () => ({ commands: { set } }));
    await syncCommands(client, [], '123', logger);
    expect(set).toHaveBeenCalledWith([]);
  });

  test('без dev-гильды: команды регистрируются глобально', async () => {
    const appSet = mock(async () => {});
    const client = fakeClient(() => {
      throw new Error('не должен зваться');
    }, appSet);
    await syncCommands(client, [], undefined, logger);
    expect(appSet).toHaveBeenCalledWith([]);
  });
});
