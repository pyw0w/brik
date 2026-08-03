import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Handler } from '../handler.ts';
import type { Module } from '../module.ts';

export interface Discovered {
  module: Module;
  handler: Handler;
}

/**
 * Реестр обнаруженных модулей и Handler-ов.
 * Авто-дискавери по конвенции: каждый подкаталог с module.ts — модуль.
 */
export class Registry {
  private readonly modules = new Map<string, Module>();
  private readonly handlers = new Map<string, Discovered>();
  private version = 0;

  get size(): number {
    return this.modules.size;
  }

  getModules(): Module[] {
    return [...this.modules.values()];
  }

  findModule(name: string): Module | undefined {
    return this.modules.get(name);
  }

  findHandler(commandName: string): Discovered | undefined {
    return this.handlers.get(commandName);
  }

  async discover(modulesDir: string): Promise<void> {
    this.modules.clear();
    this.handlers.clear();
    this.version += 1;

    const entries = readdirSync(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const moduleFile = join(modulesDir, entry.name, 'module.ts');
      if (!existsSync(moduleFile)) continue;

      const url = `${pathToFileURL(moduleFile).href}?v=${this.version}`;
      const loaded = (await import(url)) as { default?: Module };
      const mod = loaded.default;
      if (!mod || typeof mod.name !== 'string') {
        throw new Error(`Модуль ${entry.name}: module.ts должен экспортировать defineModule по умолчанию`);
      }
      this.register(mod);
    }
  }

  /** Регистрирует модуль вручную (дискавери зовёт это же; публично — для тестов/хоста). */
  register(mod: Module): void {
    if (this.modules.has(mod.name)) {
      throw new Error(`Дубликат имени модуля: ${mod.name}`);
    }
    this.modules.set(mod.name, mod);
    for (const handler of mod.handlers) {
      if (this.handlers.has(handler.name)) {
        const owner = this.handlers.get(handler.name)!.module.name;
        throw new Error(`Команда "${handler.name}" уже объявлена в модуле ${owner}`);
      }
      this.handlers.set(handler.name, { module: mod, handler });
    }
  }
}
