import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeApp } from './compose.ts';

const dir = join(import.meta.dir, '..', '..', '.data', 'lifecycle-services-test');
const modulesDir = join(dir, 'modules');
const servicesDir = join(dir, 'services');

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__weatherClosed;
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
});
