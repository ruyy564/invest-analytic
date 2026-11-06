import { jest } from '@jest/globals';
import { formatLogEntry } from '../../src/observability/logger.js';
import { maskSecret, redact } from '../../src/observability/redact.js';
import { buildTraceUrl, resolveOrgId } from '../../src/observability/run-collector.js';

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

describe('организация для ссылки', () => {
  const template = 'https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}';
  const apiKey = 'test-key';

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
