import { Writable } from 'node:stream';
import {
  createAppLogger,
  runLogger,
  toNestLogger,
  withLogContext,
} from '../../src/platform/logging/index.js';

/** Поток-накопитель: каждая запись — отдельная JSON-строка. */
const sink = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const entries = (): Record<string, unknown>[] =>
    chunks
      .join('')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stream, entries };
};

describe('структурные логи', () => {
  it('пишет JSON-запись с уровнем, сообщением и полями', () => {
    const target = sink();
    const logger = createAppLogger({ level: 'debug', env: 'test', destination: target.stream });

    logger.info({ intent: 'data_lookup', durationMs: 12 }, 'ответ готов');

    const [entry] = target.entries();
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('ответ готов');
    expect(entry.intent).toBe('data_lookup');
    expect(entry.durationMs).toBe(12);
    expect(entry.service).toBe('invest-analytic');
    expect(entry.env).toBe('test');
    expect(typeof entry.time).toBe('string');
    expect(entry.pid).toBeUndefined();
  });

  it('не пишет записи ниже настроенного уровня', () => {
    const target = sink();
    const logger = createAppLogger({ level: 'warn', destination: target.stream });

    logger.info('скрыто');
    logger.warn('видно');

    expect(target.entries().map((entry) => entry.msg)).toEqual(['видно']);
  });

  it('маскирует секретные поля и токены в тексте', () => {
    const target = sink();
    const logger = createAppLogger({ level: 'info', destination: target.stream });

    logger.info({ token: 'abcdef123456', apiKey: 'key-123456' }, 'запрос');
    logger.info('Authorization: Bearer secret-token-value', 'заголовок');

    const [first, second] = target.entries();
    expect(first.token).toBe('ab***56');
    expect(first.apiKey).toBe('ke***56');
    expect(second.msg).toContain('Bearer ***');
    expect(JSON.stringify(second)).not.toContain('secret-token-value');
  });

  it('дочерний логгер прогона добавляет runId и сессию', () => {
    const target = sink();
    const logger = createAppLogger({ level: 'info', destination: target.stream });

    runLogger(logger, { runId: 'run-1', sessionId: 's-1' }).info('шаг');
    logger.info('вне прогона');

    const [child, parent] = target.entries();
    expect(child.runId).toBe('run-1');
    expect(child.sessionId).toBe('s-1');
    expect(parent.runId).toBeUndefined();
  });

  it('мост к Nest сохраняет сообщение и контекст в JSON', () => {
    const target = sink();
    const nest = toNestLogger(createAppLogger({ level: 'debug', destination: target.stream }));

    nest.log('старт', 'Bootstrap');
    nest.error('сбой', 'stack', 'Service');

    const [info, error] = target.entries();
    expect(info.msg).toBe('старт');
    expect(info.context).toBe('Bootstrap');
    expect(error.level).toBe('error');
    expect(error.msg).toBe('сбой');
    expect(error.context).toBe('Service');
  });

  it('контекст прогона попадает в записи узлов без правок самих узлов', async () => {
    const target = sink();
    const nest = toNestLogger(createAppLogger({ level: 'info', destination: target.stream }));

    await withLogContext({ runId: 'run-42', intent: 'portfolio_review' }, async () => {
      nest.log('узел работает', 'ClassifyNode');
      await Promise.resolve();
      nest.log('после await', 'AgentNode');
    });
    nest.log('вне прогона', 'Bootstrap');

    const [first, second, outside] = target.entries();
    expect(first.runId).toBe('run-42');
    expect(first.intent).toBe('portfolio_review');
    expect(first.context).toBe('ClassifyNode');
    expect(second.runId).toBe('run-42');
    expect(outside.runId).toBeUndefined();
  });
});
