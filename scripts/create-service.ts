import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Использование: bun run create:service <name> (только a-z, 0-9, -)');
  process.exit(1);
}

const dir = join('src', 'services', name);
mkdirSync(dir, { recursive: true });

const template = `import { defineService } from '../../core/index.ts';

export interface ${name}Api {
  // TODO: методы API сервиса
}

declare module '../../core/index.ts' {
  interface ServiceMap {
    ${name}: ${name}Api;
  }
}

export default defineService({
  name: '${name}',
  description: 'Что делает сервис',
  init: () => {
    // TODO: инициализация (клиент, соединение)
    return {} satisfies ${name}Api;
  },
  // close: (api) => { /* teardown */ },
});
`;

writeFileSync(join(dir, 'service.ts'), template);

console.log(`Создан сервис: src/services/${name}/`);
console.log('Дальше:');
console.log('  1. Отредактируйте src/services/<name>/service.ts');
console.log('  2. В модуле укажите services: [\'<name>\'] и используйте ctx.services.<name>');
console.log('  3. Опции сервиса — в bot.config.ts: services.<name>.options (схема optionsSchema)');
