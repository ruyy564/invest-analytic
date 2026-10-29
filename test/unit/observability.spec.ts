import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { formatLogEntry } from '../../src/observability/logger.js';
import { maskSecret, redact } from '../../src/observability/redact.js';
import { buildTraceUrl, resolveOrgId, resolveRootRunId } from '../../src/observability/run-collector.js';

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
});

describe('поиск прогона в LangSmith', () => {
  const apiKey = 'lsv2_test_key';
  const template = 'https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}';

  /** Асинхронный источник прогонов: отдаёт список или бросает ошибку. */
  type Run = { id?: string; name?: string; metadata?: Record<string, unknown> };
  const runsOf =
    (items: Run[] | Error) =>
    (project: string): AsyncIterable<Run> => {
      expect(project).toBe('invest');
      const iterator = async function* iterate(): AsyncGenerator<Run> {
        if (items instanceof Error) {
          throw items;
        }
        for (const item of items) {
          yield item;
        }
      };
      return iterator();
    };

  it('сопоставляет прогон по requestId из метаданных', async () => {
    const runId = await resolveRootRunId(
      { project: 'invest', requestId: 'req-2', maxAttempts: 1 },
      runsOf([
        { id: 'other-request', name: 'LangGraph', metadata: { requestId: 'req-1' } },
        { id: 'wanted', name: 'LangGraph', metadata: { requestId: 'req-2' } },
      ]),
    );

    expect(runId).toBe('wanted');
  });

  it('пропускает прогон без совпадения, чтобы ссылка не вела в чужой трейс', async () => {
    const runId = await resolveRootRunId(
      { project: 'invest', requestId: 'req-9', maxAttempts: 2, delayMs: 1 },
      runsOf([{ id: 'other-request', name: 'LangGraph', metadata: { requestId: 'req-1' } }]),
    );

    expect(runId).toBeUndefined();
  });

  it('берёт прогон графа, а не корневые спаны инструментов', async () => {
    const runId = await resolveRootRunId(
      { project: 'invest', maxAttempts: 1 },
      runsOf([
        { id: 'tools-run', name: 'invest_list_accounts' },
        { id: 'graph-run', name: 'LangGraph' },
        { id: 'old-graph-run', name: 'LangGraph' },
      ]),
    );

    expect(runId).toBe('graph-run');
  });

  it('повторяет запрос, пока экспорт не дошёл до LangSmith', async () => {
    let call = 0;
    const flaky = runsOf([]);
    const source = (project: string): AsyncIterable<{ id?: string; name?: string }> => {
      call += 1;
      return call > 1 ? runsOf([{ id: 'late-run', name: 'LangGraph' }])(project) : flaky(project);
    };

    await expect(
      resolveRootRunId({ project: 'invest', maxAttempts: 3, delayMs: 1 }, source),
    ).resolves.toBe('late-run');
    expect(call).toBe(2);
  });

  it('fail-open: при ошибке LangSmith ссылки нет', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const runId = await resolveRootRunId(
      { project: 'invest', maxAttempts: 2, delayMs: 1 },
      runsOf(new Error('ECONNREFUSED')),
    );

    expect(runId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ссылка на трейс недоступна'));
    warn.mockRestore();
  });

  it('без runId или orgId ссылка не строится', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(resolveOrgId(apiKey)).resolves.toBeUndefined();
    expect(buildTraceUrl(template, { runId: 'r1', project: 'invest' })).toBeUndefined();
  });

  it('организацию отдаёт LangSmith по ключу либо из env', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'org-1' }), { status: 200 }));

    await expect(resolveOrgId(apiKey)).resolves.toBe('org-1');
    expect(spy).toHaveBeenCalledWith('https://api.smith.langchain.com/api/v1/orgs/current', {
      headers: { 'x-api-key': apiKey },
    });
    expect(buildTraceUrl(template, { runId: 'r1', orgId: 'org-1', project: 'invest' })).toBe(
      'https://smith.langchain.com/o/org-1/projects/p/invest/r/r1',
    );
    await expect(resolveOrgId(undefined)).resolves.toBeUndefined();
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
