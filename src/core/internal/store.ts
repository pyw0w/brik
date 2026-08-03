import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChannelMemory, Store } from '../types.ts';

/**
 * Персистентный KV-слой модуля: JSON-файл в .data/<moduleName>.json.
 * Пишет атомарно (temp + rename); память кэшируется в процессе.
 */
export class FileStore implements Store {
  private cache = new Map<string, unknown>();
  private readonly file: string;

  constructor(private readonly moduleName: string, private readonly dataDir = '.data') {
    this.file = join(dataDir, `${moduleName}.json`);
    mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      this.cache = new Map(Object.entries(raw));
    } catch {
      this.cache = new Map();
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.cache), null, 2));
    renameSync(tmp, this.file);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    this.persist();
  }

  async delete(key: string): Promise<void> {
    if (!this.cache.delete(key)) return;
    this.persist();
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  /** Сброс хранилища модуля (используется в тестах и при перезагрузке). */
  async clear(): Promise<void> {
    this.cache.clear();
    rmSync(this.file, { force: true });
  }
}

/** Диалоговая память по каналу (in-memory; сценарии многошаговых диалогов). */
export class InMemoryChannelMemory implements ChannelMemory {
  private readonly map = new Map<string, unknown>();

  private key(channelId: string, key: string): string {
    return `${channelId}:${key}`;
  }

  async get(channelId: string, key: string): Promise<unknown | undefined> {
    return this.map.get(this.key(channelId, key));
  }

  async set(channelId: string, key: string, value: unknown): Promise<void> {
    this.map.set(this.key(channelId, key), value);
  }

  async delete(channelId: string, key: string): Promise<void> {
    this.map.delete(this.key(channelId, key));
  }
}

/** In-memory Store для тестов (ничего не пишет на диск). */
export class MemoryStore implements Store {
  private readonly map = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}
