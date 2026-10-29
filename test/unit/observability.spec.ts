import { formatLogEntry } from '../../src/observability/logger.js';
import { maskSecret, redact } from '../../src/observability/redact.js';
import { RunCollector, buildTraceUrl } from '../../src/observability/run-collector.js';

describe('маскирование секретов', () => {
  it('маскирует Bearer-заголовки и секретные поля', () => {
    expect(redact('Authorization: Bearer t.secret-token-value')).toBe(
      'Authorization: Bearer ***',
    );
    expect(redact({ token: 'abcdef123456', model: 'gpt' })).toEqual({
      token: 'ab***56',
      model: 'gpt',
    });
  });

  it('рекурсивно обходит объекты и массивы', () => {
    expect(redact({ servers: [{ name: 'tinkoff', apiKey: 'super-secret' }] })).toEqual({
      servers: [{ name: 'tinkoff', apiKey: 'su***et' }],
    });
  });

  it('короткие секреты маскируются полностью', () => {
    expect(maskSecret('abc')).toBe('***');
  });
});

describe('ссылка на трейс', () => {
  const template = 'https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}';

  it('подставляет организацию, проект и прогон', () => {
    expect(buildTraceUrl(template, { runId: 'r1', orgId: 'o1', project: 'invest' })).toBe(
      'https://smith.langchain.com/o/o1/projects/p/invest/r/r1',
    );
  });

  it('не строит ссылку без прогона или организации', () => {
    expect(buildTraceUrl(template, { project: 'invest', orgId: 'o1' })).toBeUndefined();
    expect(buildTraceUrl(template, { runId: 'r1', project: 'invest' })).toBeUndefined();
    expect(
      buildTraceUrl('https://smith.langchain.com/projects/p/{project}/r/{runId}', {
        runId: 'r1',
        project: 'invest',
      }),
    ).toBe('https://smith.langchain.com/projects/p/invest/r/r1');
  });

  it('запоминает корневой прогон', () => {
    const collector = new RunCollector();
    collector.handleChainStart('chain', {}, 'run-1');
    collector.handleChainStart('chain', {}, 'run-2');

    expect(collector.runId).toBe('run-1');
  });
});

describe('структурные логи', () => {
  it('не пишет текст вопроса по умолчанию', () => {
    const entry = formatLogEntry({
      requestId: 'req-1',
      intent: 'portfolio',
      question: 'что у меня в портфеле?',
      logQuestionText: false,
    });

    expect(entry).toEqual({ requestId: 'req-1', intent: 'portfolio' });
  });

  it('пишет вопрос при включённом флаге и добавляет метрики', () => {
    const entry = formatLogEntry({
      requestId: 'req-1',
      sessionId: 's-1',
      tools: ['tinkoff__invest_get_portfolio'],
      durationMs: 1200,
      errorCode: 'mcp_unavailable',
      question: 'Bearer abc.def',
      logQuestionText: true,
    });

    expect(entry).toMatchObject({
      requestId: 'req-1',
      sessionId: 's-1',
      durationMs: 1200,
      errorCode: 'mcp_unavailable',
      question: 'Bearer ***',
    });
  });
});
