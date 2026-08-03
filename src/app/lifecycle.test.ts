import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeApp } from './compose.ts';

const dir = join(import.meta.dir, '..', '..', '.data', 'lifecycle-services-test');
const modulesDir = join(dir, 'modules');
const servicesDir = join(dir, 'services');

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const writeServiceFixture = (name: string, body: string) => {
  mkdirSync(join(servicesDir, name), { recursive: true });
  writeFileSync(join(servicesDir, name, 'service.ts'), body);
};

const writeModuleFixture = (group: string, name: string, body: string) => {
  const moduleDir = join(dir, group, name);
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, 'module.ts'), body);
};

const simpleModule = (name: string, services: string[]) => `import { defineHandler, defineModule } from '../../../../src/core/index.ts';
export default defineModule({
  name: '${name}',
  services: [${services.map((s) => `'${s}'`).join(', ')}],
  handlers: [
    defineHandler({
      name: 'ping',
      description: 'Проверка',
      run: () => ({ kind: 'message', content: 'ok' }),
    }),
  ],
});
`;

beforeAll(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(servicesDir, 'weather'), { recursive: true });
  mkdirSync(join(modulesDir, 'forecast'), { recursive: true });

  writeFileSync(
    join(servicesDir, 'weather', 'service.ts'),
    `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'weather',
  init: () => ({ now: () => '+10' }),
  close: () => { globalThis.__weatherClosed = true; },
});
`,
  );

  writeFileSync(
    join(modulesDir, 'forecast', 'module.ts'),
    `import { defineHandler, defineModule } from '../../../../src/core/index.ts';
export default defineModule({
  name: 'forecast',
  services: ['weather'],
  handlers: [
    defineHandler({
      name: 'forecast',
      description: 'Погода',
      run: ({ services }) => ({ kind: 'message', content: services.weather.now() }),
    }),
  ],
});
`,
  );

  writeServiceFixture('req-api', `import { z } from 'zod';
import { defineService } from '../../../../src/core/index.ts';
export default defineService<{ apiKey?: string }>({
  name: 'req-api',
  description: 'Сервис с обязательными опциями',
  optionsSchema: z.object({ apiKey: z.string().min(3) }),
  init: () => {
    globalThis.__reqApiInit = true;
    return {};
  },
});
`);
  writeModuleFixture('modules-req-api', 'req-api', simpleModule('req-api', ['req-api']));

  writeServiceFixture('needed', `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'needed',
  init: () => {
    globalThis.__neededInit = true;
    return {};
  },
});
`);
  writeModuleFixture('modules-needed', 'needed', simpleModule('needed', ['needed']));

  writeServiceFixture('neverinit', `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'neverinit',
  init: () => {
    globalThis.__neverInit = true;
    return {};
  },
});
`);

  writeServiceFixture('a', `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'a',
  init: () => {
    globalThis.__initOrder.push('a');
    return {};
  },
  close: () => {
    globalThis.__closeOrder.push('a');
  },
});
`);
  writeServiceFixture('b', `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'b',
  init: () => {
    globalThis.__initOrder.push('b');
    return {};
  },
  close: () => {
    globalThis.__closeOrder.push('b');
  },
});
`);
  writeModuleFixture('modules-trace', 'trace', simpleModule('trace', ['a', 'b']));

  writeServiceFixture('boom', `import { defineService } from '../../../../src/core/index.ts';
export default defineService({
  name: 'boom',
  init: () => {
    throw new Error('kaboom');
  },
});
`);
  writeModuleFixture('modules-boom', 'boom', simpleModule('boom', ['boom']));
});

afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__weatherClosed;
  delete g.__reqApiInit;
  delete g.__neededInit;
  delete g.__neverInit;
  delete g.__initOrder;
  delete g.__closeOrder;
  rmSync(dir, { recursive: true, force: true });
});

describe('composeApp с сервисами (offline)', () => {
  test('init сервиса происходит до setup и run команды его видит', async () => {
    const app = composeApp({ modules: { forecast: { enabled: true } } }, {
      modulesDir,
      servicesDir,
      syncSlashCommands: false,
      logger,
    });
    await app.lifecycle.start();
    const result = await app.interactor.handle(
      { commandName: 'forecast', args: {}, author: { id: 'u1', username: 'U' }, channel: { id: 'c1', guildId: 'g1' } },
      { preconditions: {}, granted: new Set() },
    );
    expect(result).toMatchObject({ kind: 'message' });
    if (result?.kind === 'message') expect(result.content).toBe('+10');
    await app.lifecycle.shutdown();
  });

  test('модуль с неизвестным сервисом — ошибка старта', async () => {
    const app = composeApp({ modules: { forecast: { enabled: true } } }, {
      modulesDir,
      servicesDir: join(dir, 'empty-services'),
      syncSlashCommands: false,
      logger,
    });
    await expect(app.lifecycle.start()).rejects.toThrow('weather');
  });

  test('close сервиса вызывается на shutdown', async () => {
    const app = composeApp({ modules: { forecast: { enabled: true } } }, {
      modulesDir,
      servicesDir,
      syncSlashCommands: false,
      logger,
    });
    await app.lifecycle.start();
    await app.lifecycle.shutdown();
    expect((globalThis as Record<string, unknown>).__weatherClosed).toBe(true);
  });

  test('невалидные опции сервиса — ошибка старта', async () => {
    const app = composeApp(
      {
        modules: { 'req-api': { enabled: true } },
        services: { 'req-api': { options: { apiKey: 'x' } } },
      },
      {
        modulesDir: join(dir, 'modules-req-api'),
        servicesDir,
        syncSlashCommands: false,
        logger,
      },
    );
    await expect(app.lifecycle.start()).rejects.toThrow(/req-api.*невалидны/);
  });

  test('отключённый сервис, нужный модулю, — ошибка старта', async () => {
    const app = composeApp(
      {
        modules: { 'req-api': { enabled: true } },
        services: { 'req-api': { enabled: false } },
      },
      {
        modulesDir: join(dir, 'modules-req-api'),
        servicesDir,
        syncSlashCommands: false,
        logger,
      },
    );
    await expect(app.lifecycle.start()).rejects.toThrow(/req-api.*отключён/);
  });

  test('сервис не строится, если его не объявляет ни один включённый модуль', async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.__neverInit;
    delete g.__neededInit;
    const app = composeApp(
      { modules: { needed: { enabled: true } } },
      {
        modulesDir: join(dir, 'modules-needed'),
        servicesDir,
        syncSlashCommands: false,
        logger,
      },
    );
    await app.lifecycle.start();
    expect(g.__neverInit).toBeUndefined();
    expect(g.__neededInit).toBe(true);
    await app.lifecycle.shutdown();
  });

  test('close сервисов вызывается в порядке, обратном инициализации', async () => {
    const g = globalThis as Record<string, unknown>;
    g.__initOrder = [];
    g.__closeOrder = [];
    const app = composeApp(
      { modules: { trace: { enabled: true } } },
      {
        modulesDir: join(dir, 'modules-trace'),
        servicesDir,
        syncSlashCommands: false,
        logger,
      },
    );
    await app.lifecycle.start();
    await app.lifecycle.shutdown();
    expect(g.__initOrder).toEqual(['a', 'b']);
    expect(g.__closeOrder).toEqual(['b', 'a']);
  });

  test('падение init сервиса — ошибка старта', async () => {
    const app = composeApp(
      { modules: { boom: { enabled: true } } },
      {
        modulesDir: join(dir, 'modules-boom'),
        servicesDir,
        syncSlashCommands: false,
        logger,
      },
    );
    await expect(app.lifecycle.start()).rejects.toThrow(/boom.*init упал/);
  });
});
