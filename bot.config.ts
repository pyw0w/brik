import type { BotConfig } from './src/core/internal/config.ts';

export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
    forecast: { enabled: true },
    anime: { enabled: true },
    buttons: { enabled: true },
    logs: { enabled: true },
  },
  services: {
    shikimori: {
      options: {
        userAgent: process.env.SHIKIMORI_USER_AGENT ?? 'Brik (Discord bot; https://github.com/pyw0w/brik)',
      },
    },
  },
  owners: [],
} satisfies BotConfig;
