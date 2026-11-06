import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { RunJournal, formatReplay, summarizeRuns } from '../../src/platform/runs/index.js';
import { stopReasonOf, toolsOf, usageOf } from '../../src/agent/runner/journal-summary.js';
import type { RunResult } from '../../src/agent/runner/runner.types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invest-runs-'));
});

afterEach(() => {
  // Временные файлы журнала не остаются после теста.
  rmSync(dir, { recursive: true, force: true });
});

const resultOf = (overrides: Partial<RunResult> = {}): RunResult => ({
  runId: 'run-1',
  status: 'completed',
  intent: 'data_lookup',
  partial: false,
  ...overrides,
});

describe('журнал прогона', () => {
  it('пишет JSONL по файлу на прогон', () => {
    const journal = new RunJournal({ dir, runId: 'run-1', now: () => new Date('2026-11-06T10:00:00Z') });

    journal.append({ type: 'run_started', sessionId: 's-1' });
    journal.append({ type: 'run_finished', tools: ['instruments__prices'], stopReason: 'answered' });

    const lines = readFileSync(journal.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const [started, finished] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(started).toMatchObject({ type: 'run_started', sessionId: 's-1' });
    expect(started.at).toBe('2026-11-06T10:00:00.000Z');
    expect(finished).toMatchObject({ type: 'run_finished', stopReason: 'answered' });
    expect(journal.read()).toHaveLength(2);
  });

  it('маскирует секреты перед записью', () => {
    const journal = new RunJournal({ dir, runId: 'run-secret' });

    journal.append({ type: 'tool_call', tool: 'tinkoff', token: 'abcdef123456' });
    journal.append({ type: 'tool_result', note: 'Authorization: Bearer secret-value' });

    const [call, response] = journal.read();
    expect(call.token).toBe('ab***56');
    expect(String(response.note)).toContain('Bearer ***');
    expect(JSON.stringify(response)).not.toContain('secret-value');
  });

  it('ошибка записи не прерывает прогон', () => {
    const errors: string[] = [];
    const journal = new RunJournal({
      dir,
      runId: 'run-broken',
      onError: (error) => errors.push(error.message),
    });
    // Подменяем путь на недоступный каталог: запись должна сообщить об ошибке.
    Object.defineProperty(journal, 'path', { value: join(dir, 'missing', 'x.jsonl') });

    expect(() => journal.append({ type: 'run_started' })).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('итог прогона для журнала', () => {
  it('собирает имена запрошенных инструментов', () => {
    const messages = [
      new HumanMessage('что в портфеле'),
      new AIMessage({
        content: '',
        tool_calls: [
          { id: '1', name: 'portfolio__snapshot', args: {} },
          { id: '2', name: 'instruments__prices', args: {} },
        ],
      }),
      new ToolMessage({ tool_call_id: '1', content: 'ok' }),
      new AIMessage('готово'),
    ];

    expect(toolsOf(messages)).toEqual(['portfolio__snapshot', 'instruments__prices']);
  });

  it('суммирует расход токенов, если провайдер его отдал', () => {
    const messages = [
      new AIMessage({
        content: 'a',
        usage_metadata: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }),
      new AIMessage({
        content: 'b',
        usage_metadata: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      }),
    ];

    expect(usageOf(messages)).toEqual({ inputTokens: 17, outputTokens: 7 });
    expect(usageOf([new HumanMessage('без расхода')])).toBeUndefined();
  });

  it('определяет причину остановки', () => {
    expect(stopReasonOf(resultOf({ status: 'awaiting_approval' }))).toBe('approval');
    // Бюджет определяется счётчиком прогона, а не текстом сообщения инструмента.
    expect(stopReasonOf(resultOf(), { budgetExhausted: true })).toBe('budget');
    expect(stopReasonOf(resultOf({ intent: 'off_topic' }))).toBe('guard');
    expect(stopReasonOf(resultOf({ partial: true }))).toBe('no_data');
    expect(stopReasonOf(resultOf())).toBe('answered');
  });
});

describe('воспроизведение прогона', () => {
  it('печатает транскрипт по журналу без сетевых вызовов', () => {
    const events = [
      { at: '2026-11-06T10:00:00.000Z', type: 'run_started' },
      { at: '2026-11-06T10:00:01.000Z', type: 'tool_call', tool: 'instruments__prices', args: {} },
      { at: '2026-11-06T10:00:02.000Z', type: 'tool_result', tool: 'instruments__prices', ok: false },
      {
        at: '2026-11-06T10:00:03.000Z',
        type: 'run_finished',
        status: 'completed',
        stopReason: 'no_data',
        partial: true,
        tools: ['instruments__prices'],
        usage: { inputTokens: 12, outputTokens: 6 },
        coverage: [{ source: 'news', status: 'missing', reason: 'таймаут' }],
      },
    ];

    const text = formatReplay(events, 'run-1');

    expect(text).toContain('Прогон run-1');
    expect(text).toContain('старт');
    expect(text).toContain('вызов instruments__prices');
    expect(text).toContain('результат instruments__prices: ошибка');
    expect(text).toContain('причина=no_data');
    expect(text).toContain('токены: вход 12, выход 6');
    expect(text).toContain('источник news: missing (таймаут)');
  });

  it('пустой журнал не считается ошибкой', () => {
    expect(formatReplay([], 'run-empty')).toContain('журнал пуст');
  });
});

describe('метрики по журналам', () => {
  it('считает доли, стоимость и перцентили по интентам', () => {
    const events = [
      {
        intent: 'data_lookup',
        partial: false,
        durationMs: 100,
        tools: [{ name: 'instruments__prices', ok: true }],
        coverage: [{ source: 'prices', status: 'ok' }],
        refusals: 0,
        costUsd: 0.01,
      },
      {
        intent: 'data_lookup',
        partial: true,
        durationMs: 300,
        tools: [{ name: 'instruments__prices', ok: false }],
        coverage: [{ source: 'news', status: 'missing' }],
        refusals: 1,
        costUsd: 0.02,
      },
      { intent: 'off_topic', partial: false, durationMs: 50 },
    ];

    const { byIntent, total } = summarizeRuns(events);

    expect(total.runs).toBe(3);
    expect(byIntent.data_lookup.runs).toBe(2);
    expect(byIntent.data_lookup.partialRate).toBe(0.5);
    expect(byIntent.data_lookup.refusalRate).toBe(0.5);
    // Две ошибки (failed + missing) на четыре источника.
    expect(byIntent.data_lookup.toolErrorRate).toBe(0.5);
    expect(byIntent.data_lookup.costUsd).toBeCloseTo(0.03);
    expect(byIntent.data_lookup.p50Ms).toBe(100);
    expect(byIntent.data_lookup.p95Ms).toBe(300);
  });

  it('пустой набор не делит на ноль', () => {
    const { total } = summarizeRuns([]);

    expect(total).toMatchObject({ runs: 0, partialRate: 0, toolErrorRate: 0, p95Ms: 0 });
  });
});
