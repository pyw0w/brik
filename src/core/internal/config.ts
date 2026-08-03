import { pathToFileURL } from 'node:url';

export interface ModuleEntry {
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface BotConfig {
  /** Токен бота (обычно из окружения DISCORD_TOKEN). */
  token?: string;
  /** Ключи — имена модулей; решения Enable. */
  modules: Record<string, ModuleEntry>;
  /** ID пользователей-владельцев (для предусловия ownerOnly). */
  owners?: string[];
  /** Гильда для мгновенной регистрации команд в dev-режиме. */
  devGuildId?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/** Загружает bot.config.ts (передаётся путь или берётся BOT_CONFIG_PATH/DISCORD env). */
export async function loadConfig(configPath = process.env.BOT_CONFIG_PATH ?? 'bot.config.ts'): Promise<BotConfig> {
  const url = `${pathToFileURL(configPath).href}?v=${Date.now()}`;
  const loaded = (await import(url)) as { default?: BotConfig };
  if (!loaded.default || !loaded.default.modules) {
    throw new Error(`Конфиг ${configPath} должен экспортировать { modules: {...} } по умолчанию`);
  }
  return loaded.default;
}

export function envToken(): string | undefined {
  return process.env.DISCORD_TOKEN;
}
