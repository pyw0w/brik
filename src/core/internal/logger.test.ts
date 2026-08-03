import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createLogger } from './logger.ts';

const orig = { log: console.log, warn: console.warn, error: console.error };

afterEach(() => {
  console.log = orig.log;
  console.warn = orig.warn;
  console.error = orig.error;
});

describe('createLogger', () => {
  test('пишет debug/info/warn в console.log, error — в console.error с стеком', () => {
    const log = mock((_line: string) => {});
    const error = mock((_line: string) => {});
    console.log = log as never;
    console.error = error as never;

    const logger = createLogger('test', 'debug');
    logger.debug('отладка', { a: 1 });
    logger.info('инфо');
    logger.error('ошибка', new Error('boom'));

    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]?.[0])).toContain('[DEBUG] [test] отладка {"a":1}');
    expect(String(log.mock.calls[1]?.[0])).toContain('[INFO] [test] инфо');
    // error: строка с сообщением + стек
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain('[ERROR] [test] ошибка {"error":"boom"}');
  });

  test('warn использует console.warn', () => {
    const warn = mock((_line: string) => {});
    console.warn = warn as never;
    const logger = createLogger('test', 'warn');
    logger.warn('внимание');
    expect(String(warn.mock.calls[0]?.[0])).toContain('[WARN] [test] внимание');
  });

  test('сообщения ниже minLevel отфильтровываются', () => {
    const log = mock((_line: string) => {});
    console.log = log as never;
    const logger = createLogger('test', 'error');
    logger.debug('скрыто');
    logger.info('скрыто');
    expect(log).not.toHaveBeenCalled();
  });

  test('error с ошибкой в строке и без meta', () => {
    const error = mock((_line: string) => {});
    console.error = error as never;
    const logger = createLogger('test', 'error');
    logger.error('с текстом', 'причина');
    logger.error('без причины');
    expect(String(error.mock.calls[0]?.[0])).toContain('{"error":"причина"}');
    expect(String(error.mock.calls[1]?.[0])).not.toContain('{"error"');
  });
});