import { arg, defineHandler, defineModule, type Store } from '../../core/index.ts';
import {
  configKey,
  createVoiceManager,
  DEFAULT_NAME_TEMPLATE,
  parseChannelMention,
  type TempChannelRecord,
  type VoiceConfig,
  type VoiceManager,
  type VoiceStateLike,
} from './manager.ts';

let activeManager: VoiceManager | undefined;

/** Тестовый хук: подмена VoiceManager */
export function setVoiceManagerForTest(manager: VoiceManager | undefined) {
  activeManager = manager;
}

export function getVoiceManager() {
  return activeManager;
}

/** Общая функция настройки временных каналов (используется в /setup и /voice setup) */
export async function executeVoiceSetup(params: {
  guildId: string;
  category: string | undefined;
  trigger: string | undefined;
  name?: string | undefined;
  store: Store;
}) {
  if (!params.category || !params.trigger) {
    return {
      kind: 'message' as const,
      content:
        '❌ Для настройки укажите оба параметра: категорию (`category`) и триггер-канал (`trigger`).\nПример: `/setup category:123456789012345678 trigger:#создать-войс`',
      ephemeral: true,
    };
  }

  const categoryId = parseChannelMention(params.category);
  const triggerChannelId = parseChannelMention(params.trigger);

  if (!categoryId || !triggerChannelId) {
    return {
      kind: 'message' as const,
      content: '❌ Неверный формат ID канала или категории. Укажите упоминание (<#123>) или числовой ID.',
      ephemeral: true,
    };
  }

  const config: VoiceConfig = {
    triggerChannelId,
    categoryId,
    ...(params.name?.trim() ? { nameTemplate: params.name.trim() } : {}),
  };

  await params.store.set(configKey(params.guildId), config);

  return {
    kind: 'message' as const,
    content: `✅ **Временные голосовые каналы настроены!**\n• Триггер: <#${triggerChannelId}>\n• Категория: <#${categoryId}>\n• Шаблон: \`${config.nameTemplate ?? DEFAULT_NAME_TEMPLATE}\``,
  };
}

export default defineModule({
  name: 'voice',
  description: 'Автосоздание и удаление временных голосовых каналов в категории (Join to Create)',
  handlers: [
    defineHandler({
      name: 'setup',
      description: 'Быстрая настройка временных голосовых каналов (категория и триггер)',
      args: {
        category: arg.string('категория для создаваемых комнат (#канал или ID)'),
        trigger: arg.string('триггер-канал «Создать комнату» (#канал или ID)'),
        name: arg.string('шаблон названия комнат (по умолчанию: "🔊 {user}")').optional(),
      },
      preconditions: [
        { type: 'guildOnly' },
        { type: 'permissions', permissions: ['ManageChannels'] },
      ],
      capabilities: ['SendMessages'],
      run: async ({ input, args, store }) => {
        const guildId = input.channel.guildId;
        if (!guildId) {
          return { kind: 'message', content: 'Команда доступна только на сервере', ephemeral: true };
        }

        return executeVoiceSetup({
          guildId,
          category: args.category,
          trigger: args.trigger,
          name: args.name,
          store,
        });
      },
    }),

    defineHandler({
      name: 'voice',
      description: 'Управление временными голосовыми каналами: setup, show, clear, cleanup',
      args: {
        action: arg.enum('действие: setup / show / clear / cleanup', ['setup', 'show', 'clear', 'cleanup']).default('show'),
        category: arg.string('категория для создаваемых комнат (#канал или ID)').optional(),
        trigger: arg.string('триггер-канал «Создать комнату» (#канал или ID)').optional(),
        name: arg.string('шаблон названия комнат (например: "🔊 {user}")').optional(),
      },
      preconditions: [
        { type: 'guildOnly' },
        { type: 'permissions', permissions: ['ManageChannels'] },
      ],
      capabilities: ['SendMessages'],
      run: async ({ input, args, store, db }) => {
        const guildId = input.channel.guildId;
        if (!guildId) {
          return { kind: 'message', content: 'Команда доступна только на сервере', ephemeral: true };
        }

        const key = configKey(guildId);

        if (args.action === 'setup') {
          return executeVoiceSetup({
            guildId,
            category: args.category,
            trigger: args.trigger,
            name: args.name,
            store,
          });
        }

        if (args.action === 'clear') {
          const config = await store.get<VoiceConfig>(key);
          if (!config) {
            return {
              kind: 'message',
              content: 'ℹ️ Временные голосовые каналы и так не настроены на этом сервере.',
              ephemeral: true,
            };
          }

          await store.delete(key);
          return {
            kind: 'message',
            content: '🗑️ Настройки временных голосовых каналов удалены. Автосоздание отключено.',
          };
        }

        if (args.action === 'cleanup') {
          if (activeManager) {
            const cleaned = await activeManager.cleanupGuild(guildId);
            return {
              kind: 'message',
              content: `🧹 Ручная очистка завершена: удалено каналов — **${cleaned}**.`,
            };
          }

          const col = db.collection<TempChannelRecord>('temp_channels');
          const total = await col.count({ guildId });
          return {
            kind: 'message',
            content: `ℹ️ В БД зарегистрировано **${total}** временных каналов. Полная очистка каналов Discord доступна при активном подключении бота.`,
          };
        }

        // action === 'show'
        const config = await store.get<VoiceConfig>(key);
        const col = db.collection<TempChannelRecord>('temp_channels');
        const activeCount = await col.count({ guildId });

        if (!config) {
          return {
            kind: 'message',
            content: '⚙️ Временные голосовые каналы **не настроены** на этом сервере.\nИспользуйте `/setup category:<категория> trigger:<канал>` для включения.',
          };
        }

        return {
          kind: 'message',
          content: `⚙️ **Настройки временных голосовых каналов:**\n• Триггер: <#${config.triggerChannelId}>\n• Категория: <#${config.categoryId}>\n• Шаблон: \`${config.nameTemplate ?? DEFAULT_NAME_TEMPLATE}\`\n• Активных комнат: **${activeCount}**`,
        };
      },
    }),
  ],
  onReady: async ({ client, db, store, logger }) => {
    const manager = createVoiceManager({ client, db, store, logger });
    activeManager = manager;

    // Восстановление после рестарта: удаление пустых/потерянных каналов, сохранение активных
    await manager.recover();

    client.on('voiceStateUpdate', (oldState, newState) => {
      void manager.handleVoiceState(oldState as unknown as VoiceStateLike, newState as unknown as VoiceStateLike);
    });

    client.on('channelDelete', (channel) => {
      void manager.handleChannelDelete(channel.id);
    });
  },
  onShutdown: () => {
    activeManager?.dispose();
    activeManager = undefined;
  },
});
