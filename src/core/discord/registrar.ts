import {
  SlashCommandBuilder,
  type Client,
} from 'discord.js';
import type { ArgSpec } from '../args.ts';
import type { Handler } from '../handler.ts';
import type { Logger } from '../types.ts';

/**
 * Единственный маппинг «тип аргумента → опция Discord».
 * Аргументы объявляются тегами ('string'/'number'/'integer'/'boolean'),
 * чтобы контракт (src/core/args.ts) не зависел от discord.js в рантайме.
 */
export function toSlashCommand(handler: Handler<any>): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName(handler.name)
    .setDescription(handler.description);

  for (const [name, a] of Object.entries(handler.args) as [string, ArgSpec][]) {
    switch (a.discordType) {
      case 'string':
        if (a.choices && a.choices.length > 0) {
          builder.addStringOption((o) =>
            o.setName(name).setDescription(a.description).setRequired(a.required)
              .addChoices(...a.choices!.map((value) => ({ name: value, value }))),
          );
        } else {
          builder.addStringOption((o) =>
            o.setName(name).setDescription(a.description).setRequired(a.required),
          );
        }
        break;
      case 'integer':
        builder.addIntegerOption((o) =>
          o.setName(name).setDescription(a.description).setRequired(a.required),
        );
        break;
      case 'number':
        builder.addNumberOption((o) =>
          o.setName(name).setDescription(a.description).setRequired(a.required),
        );
        break;
      case 'boolean':
        builder.addBooleanOption((o) =>
          o.setName(name).setDescription(a.description).setRequired(a.required),
        );
        break;
    }
  }

  return builder;
}

/**
 * Синхронизация slash-команд: на гильду (мгновенные обновления, dev) или глобально.
 * devGuildId задаёт гильду мгновенной регистрации.
 */
export async function syncCommands(
  client: Client,
  commands: SlashCommandBuilder[],
  devGuildId: string | undefined,
  logger: Logger,
): Promise<number> {
  const app = client.application;
  if (!app) throw new Error('Application недоступен до login()');

  if (devGuildId) {
    const guild = await client.guilds.fetch(devGuildId);
    await guild.commands.set(commands);
    logger.info(`Зарегистрировано ${commands.length} команд на гильду ${devGuildId}`);
  } else {
    await app.commands.set(commands);
    logger.info(`Зарегистрировано ${commands.length} команд глобально`);
  }
  return commands.length;
}
