import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Использование: bun run create:module <name> (только a-z, 0-9, -)');
  process.exit(1);
}

const modulesDir = join('src', 'modules', name);
mkdirSync(modulesDir, { recursive: true });

const moduleFile = join(modulesDir, 'module.ts');
const testFile = join(modulesDir, 'module.test.ts');

const moduleTemplate = `import { arg, defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: '${name}',
  description: 'Что делает этот модуль',
  // services: ['my-service'],  // сервис из src/services/, доступен в ctx.services
  handlers: [
    defineHandler({
      name: '${name}',
      description: 'Короткое описание команды',
      args: {
        text: arg.string('Что-нибудь'),
      },
      run: async ({ args }) => {
        return { kind: 'message', content: \`Вы сказали: \${args.text}\` };
      },
    }),
  ],
});
`;

const testTemplate = `import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль ${name}', () => {
  test('отвечает на вызов', async () => {
    const handler = module.handlers.find((h) => h.name === '${name}')!;
    const result = await runHandler(handler, { args: { text: 'привет' } });
    expect(result.kind).toBe('message');
    if (result.kind === 'message') expect(result.content).toContain('привет');
  });
});
`;

writeFileSync(moduleFile, moduleTemplate);
writeFileSync(testFile, testTemplate);

console.log(`Создан модуль: src/modules/${name}/`);
console.log(`Тест: ${testFile}`);
console.log('');
console.log('Дальше:');
console.log('  1. Отредактируйте src/modules/<name>/module.ts');
console.log('  2. bun test            # юнит-тесты (co-located рядом с кодом)');
console.log('  3. bun run dev         # dev-режим с hot reload');
console.log('  4. Включите модуль в bot.config.ts, если нужно отключить его по умолчанию');
