import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InteractionEnv } from '../core/discord/adapter.ts';
import { createLogger } from '../core/internal/logger.ts';
import { createInput } from '../core/testing.ts';
import { composeApp, type AppContext } from './compose.ts';

const config = {
  modules: { help: { enabled: true }, ping: { enabled: true }, roll: { enabled: true } },
  owners: [],
};

const logger = createLogger('test', 'error');
const dataDir = mkdtempSync(join(tmpdir(), 'ds-app-'));

let app: AppContext;

beforeAll(async () => {
  app = composeApp(config, { syncSlashCommands: false, dataDir, logger });
  await app.lifecycle.start();
});

afterAll(async () => {
  await app.lifecycle.shutdown();
  rmSync(dataDir, { recursive: true, force: true });
});

const env: InteractionEnv = { preconditions: {}, granted: new Set() };

describe('composeApp (offline-режим)', () => {
  test('discover + setup работают: /ping отвечает', async () => {
    const result = await app.interactor.handle(createInput({ commandName: 'ping' }), env);
    expect(result).toEqual({ kind: 'message', content: 'Понг!' });
  });

  test('/help читает каталог команд из Registry', async () => {
    const result = await app.interactor.handle(createInput({ commandName: 'help' }), env);
    expect(result).toMatchObject({ kind: 'message' });
    if (result && result.kind === 'message') {
      expect(result.content).toContain('/ping');
      expect(result.content).toContain('/roll');
    }
  });

  test('/roll с дефолтом работает', async () => {
    const result = await app.interactor.handle(createInput({ commandName: 'roll' }), env);
    expect(result).toMatchObject({ kind: 'message' });
    if (result && result.kind === 'message') {
      expect(result.content).toMatch(/^🎲 2d6 → \[.*\] = \*\*\d+\*\*$/);
    }
  });

  test('/roll с инвалидной формулой даёт понятную ошибку', async () => {
    const result = await app.interactor.handle(
      createInput({ commandName: 'roll', args: { dice: 'zzz' } }),
      env,
    );
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result && result.kind === 'message') {
      expect(result.content).toContain('Не понял формулу');
    }
  });
});
