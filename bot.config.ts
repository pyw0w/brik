import type { BotConfig } from './src/core/internal/config.ts';

export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
  },
  owners: [],
} satisfies BotConfig;
