import { Client, GatewayIntentBits, Partials, type SlashCommandBuilder } from 'discord.js';
import type { Logger } from '../types.ts';
import { dispatchInteraction, type InteractionHandler } from './adapter.ts';
import { syncCommands } from './registrar.ts';

export interface GatewayDeps {
  logger: Logger;
  owners: string[];
  handler: InteractionHandler;
  /** Вызывается после ready (модульные onReady). */
  onReady: (client: Client) => Promise<void>;
}

export interface Gateway {
  readonly client: Client;
  start(token: string, commands: SlashCommandBuilder[], devGuildId?: string): Promise<void>;
  destroy(): Promise<void>;
}

/** Host Discord-клиента: создаёт Client, подписывает события, синхронизирует команды. */
export function createGateway(deps: GatewayDeps): Gateway {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      // Привилегированный интент: нужен для контента удалённых/изменённых сообщений.
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  });

  client.on('interactionCreate', (interaction) => {
    void dispatchInteraction(interaction, {
      handler: deps.handler,
      owners: deps.owners,
      logger: deps.logger,
    });
  });

  /** Резолвится при clientReady; ошибка onReady пробрасывается в start(). */
  let onReadyPromise: Promise<void> = Promise.resolve();

  client.on('clientReady', () => {
    deps.logger.info(`Подключено как ${client.user?.tag ?? '?'}`);
    // Fail-fast: ошибка onReady модулей — в start(), не в unhandled rejection.
    onReadyPromise = deps.onReady(client);
    onReadyPromise.catch(() => undefined); // не даём уйти в unhandled rejection
  });

  return {
    client,
    async start(token, commands, devGuildId) {
      await client.login(token);
      await syncCommands(client, commands, devGuildId, deps.logger);
      // Ждём завершения onReady модулей; ошибка — в start() (fail-fast).
      await onReadyPromise;
    },
    async destroy() {
      await client.destroy();
    },
  };
}
