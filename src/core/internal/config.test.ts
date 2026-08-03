import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { envToken, loadConfig } from './config.ts';

const dir = join(import.meta.dir, '..', '..', '..', '.data', 'config-test');
const good = join(dir, 'good.config.ts');
const bad = join(dir, 'bad.config.ts');
const noDefault = join(dir, 'nodedefault.config.ts');

describe('loadConfig', () => {
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(good, 'export default { modules: { ping: { enabled: true } } };');
    writeFileSync(bad, 'export default {};');
    writeFileSync(noDefault, 'export const marker = 1;');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('читает валидный конфиг', async () => {
    const config = await loadConfig(good);
    expect(config.modules.ping).toEqual({ enabled: true });
  });

  test('конфиг без modules бросает', async () => {
    await expect(loadConfig(bad)).rejects.toThrow('modules');
  });

  test('конфиг без default-экспорта бросает', async () => {
    await expect(loadConfig(noDefault)).rejects.toThrow('modules');
  });

  test('читает секцию services', async () => {
    const dir2 = join(import.meta.dir, '..', '..', '..', '.data', 'config-test');
    const withServices = join(dir2, 'services.config.ts');
    writeFileSync(
      withServices,
      'export default { modules: {}, services: { weather: { options: { apiKey: "k" } } } };',
    );
    const config = await loadConfig(withServices);
    expect(config.services?.weather).toEqual({ options: { apiKey: 'k' } });
  });

  test('envToken читает DISCORD_TOKEN из окружения', () => {
    const prev = process.env.DISCORD_TOKEN;
    process.env.DISCORD_TOKEN = 'tok-123';
    try {
      expect(envToken()).toBe('tok-123');
    } finally {
      if (prev === undefined) delete process.env.DISCORD_TOKEN;
      else process.env.DISCORD_TOKEN = prev;
    }
  });
});
