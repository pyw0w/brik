import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Service } from '../service.ts';

/** Реестр сервисов: авто-дискавери по конвенции src/services/<name>/service.ts. */
export class ServiceRegistry {
  private readonly services = new Map<string, Service>();
  private version = 0;

  get size(): number {
    return this.services.size;
  }

  getServices(): Service[] {
    return [...this.services.values()];
  }

  find(name: string): Service | undefined {
    return this.services.get(name);
  }

  async discover(servicesDir: string): Promise<void> {
    this.services.clear();
    this.version += 1;
    if (!existsSync(servicesDir)) return;

    const entries = readdirSync(servicesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = join(servicesDir, entry.name, 'service.ts');
      if (!existsSync(file)) continue;

      const url = `${pathToFileURL(file).href}?v=${this.version}`;
      const loaded = (await import(url)) as { default?: Service };
      const svc = loaded.default;
      if (!svc || typeof svc.name !== 'string') {
        throw new Error(`Сервис ${entry.name}: service.ts должен экспортировать defineService по умолчанию`);
      }
      this.register(svc);
    }
  }

  /** Регистрирует сервис вручную (discover зовёт это же; публично — для тестов/хоста). */
  register(svc: Service): void {
    if (this.services.has(svc.name)) {
      throw new Error(`Дубликат имени сервиса: ${svc.name}`);
    }
    this.services.set(svc.name, svc);
  }
}
