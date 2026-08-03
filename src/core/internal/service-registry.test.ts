import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceRegistry } from './service-registry.ts';

const dir = join(import.meta.dir, '..', '..', '..', '.data', 'service-registry-test');

const hello = `import { defineService } from '../../../src/core/index.ts';
export default defineService({ name: 'hello', init: () => 'hi' });
`;

const dup1 = `import { defineService } from '../../../src/core/index.ts';
export default defineService({ name: 'same', init: () => 1 });
`;
const dup2 = dup1.replace("init: () => 1", "init: () => 2");

describe('ServiceRegistry', () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'hello'), { recursive: true });
    mkdirSync(join(dir, 'same'), { recursive: true });
    writeFileSync(join(dir, 'hello', 'service.ts'), hello);
    writeFileSync(join(dir, 'same', 'service.ts'), dup1);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('discover находит сервисы по конвенции', async () => {
    const reg = new ServiceRegistry();
    await reg.discover(dir);
    expect(reg.size).toBe(2);
    expect(reg.find('hello')).toBeDefined();
    expect(reg.find('missing')).toBeUndefined();
  });

  test('discover не падает на несуществующей папке', async () => {
    const reg = new ServiceRegistry();
    await reg.discover(join(dir, 'no-such-dir'));
    expect(reg.size).toBe(0);
  });

  test('register с дублем имени бросает', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'x', init: () => 1 });
    expect(() => reg.register({ name: 'x', init: () => 2 })).toThrow('Дубликат имени сервиса');
  });
});
