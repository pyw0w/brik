import { REST, Routes } from 'discord.js';
import { envToken, loadConfig } from '../src/core/internal/config.ts';
import { Registry } from '../src/core/internal/registry.ts';
import { toSlashCommand } from '../src/core/discord/registrar.ts';

/**
 * Регистрация slash-команд без подключения к gateway.
 * Использование: bun run deploy:commands
 * Регистрирует на dev-гильде (config.devGuildId) или глобально.
 */
const token = envToken();
if (!token) {
  console.error('Не задан токен: DISCORD_TOKEN в окружении');
  process.exit(1);
}

const config = await loadConfig();
const registry = new Registry();
await registry.discover('src/modules');

const enabled = registry.getModules().filter((m) => config.modules[m.name]?.enabled !== false);
const commands = enabled.flatMap((m) => m.handlers).map((h) => toSlashCommand(h).toJSON());

const rest = new REST({ version: '10' }).setToken(token);
const application = (await rest.get(Routes.oauth2CurrentApplication())) as { id: string };

if (config.devGuildId) {
  await rest.put(Routes.applicationGuildCommands(application.id, config.devGuildId), {
    body: commands,
  });
  console.log(`Зарегистрировано ${commands.length} команд на гильду ${config.devGuildId}`);
} else {
  await rest.put(Routes.applicationCommands(application.id), { body: commands });
  console.log(`Зарегистрировано ${commands.length} команд глобально`);
}
