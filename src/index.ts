import { composeApp } from './app/compose.ts';
import { loadConfig } from './core/internal/config.ts';

const config = await loadConfig();
const { lifecycle, logger } = composeApp(config);

// Граница процесса: ошибки, которые не пойманы явно.
process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled rejection',
    reason instanceof Error ? reason : new Error(String(reason)),
  );
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});

const shutdown = (signal: string) => {
  logger.info(`Получен ${signal}, завершаю работу...`);
  void lifecycle
    .shutdown()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Ошибка при завершении', err);
      process.exit(1);
    });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await lifecycle.start();
} catch (err) {
  logger.error('Не удалось запустить бота', err);
  process.exit(1);
}
