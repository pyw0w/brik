import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentHandlerDef } from '../handler.ts';
import type { Handler } from '../handler.ts';
import type { Module } from '../module.ts';

export interface Discovered {
  module: Module;
  handler: Handler;
}

export interface DiscoveredComponent {
  module: Module;
  handler: Handler;
  component: ComponentHandlerDef;
  /** Часть customId после "<handler>:<component>:" (пустая строка, если её нет). */
  payload: string;
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

  /**
   * Роутит customId кнопки <handler>:<component>[:<payload>] к её component-хэндлеру.
   * Имена хэндлеров глобально уникальны, поэтому префикс модуля не нужен.
   */
  findComponent(customId: string): DiscoveredComponent | undefined {
    const sep = customId.indexOf(':');
    if (sep < 0) return undefined;
    const found = this.handlers.get(customId.slice(0, sep));
    if (!found) return undefined;
    const rest = customId.slice(sep + 1);
    const sep2 = rest.indexOf(':');
    const componentId = sep2 < 0 ? rest : rest.slice(0, sep2);
    const payload = sep2 < 0 ? '' : rest.slice(sep2 + 1);
    const component = found.handler.components.find((c) => c.id === componentId);
    if (!component) return undefined;
    return { module: found.module, handler: found.handler, component, payload };
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
      this.validateComponents(handler);
      this.handlers.set(handler.name, { module: mod, handler });
    }
  }

  private validateComponents(handler: Handler): void {
    const seen = new Set<string>();
    for (const component of handler.components) {
      if (component.id.includes(':')) {
        throw new Error(
          `Компонент "${component.id}" в handler "${handler.name}": id не должен содержать ':'`,
        );
      }
      if (seen.has(component.id)) {
        throw new Error(
          `Дубликат компонента "${component.id}" в handler "${handler.name}"`,
        );
      }
      seen.add(component.id);
    }
  }
}
