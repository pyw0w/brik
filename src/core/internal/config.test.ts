import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';

const dir = join(import.meta.dir, '..', '..', '..', '.data', 'config-test');
const good = join(dir, 'good.config.ts');
const bad = join(dir, 'bad.config.ts');

describe('loadConfig', () => {
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(good, 'export default { modules: { ping: { enabled: true } } };');
    writeFileSync(bad, 'export default {};');
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
});
