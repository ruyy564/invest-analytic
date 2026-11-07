import { AIMessage } from '@langchain/core/messages';
import { ReportStoreService } from '../../src/platform/state/report-store.service.js';
import type { ScriptedStep } from '../fixtures/fake-chat-model.js';
import {
  HARNESS_ENV,
  createHarness as createHarnessBase,
  toolCall,
  type Harness,
} from '../fixtures/agent-harness.js';

/** Стенд берётся из общей фикстуры: корзины графа и поведения используют один. */
const createHarness = (answerSteps: ScriptedStep[]): Promise<Harness> =>
  createHarnessBase(answerSteps);

describe('граф агента с подтверждением', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, HARNESS_ENV);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('вопрос не по теме завершается отказом без вызова инструментов', async () => {
    const { runner, toolCalls } = await createHarness(['ответ не используется']);

    const result = await runner.run('какая погода в Москве?', 's-off-topic');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('off_topic');
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.answer).toContain('вне моей компетенции');
    expect(toolCalls()).toBe(0);
  });

  it('вопрос о возможностях отвечает справкой без данных и подтверждения', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('что ты умеешь?', 's-help');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('agent_help');
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Что умею');
    expect(result.answer).toContain('Портфель и счета');
    expect(result.answer).toContain('Новости рынка');
    // Справка не собирает данные и не создаёт отчёт.
    expect(result.report).toBeUndefined();
    expect(result.partial).toBe(false);
    expect(toolCalls()).toBe(0);
  });

  it('справочный вопрос о понятии отвечает из базы знаний без данных', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('что такое диверсификация?', 's-knowledge');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('knowledge_question');
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Диверсификация');
    expect(result.answer).toContain('Источник:');
    // Данные брокера для справочного ответа не нужны, отчёт не создаётся.
    expect(result.report).toBeUndefined();
    expect(result.partial).toBe(false);
    expect(toolCalls()).toBe(0);
  });

  it('вопрос про новости рынка отвечает сводкой без подтверждения', async () => {
    const { runner, toolCalls } = await createHarness(['ответ модели не используется']);

    const result = await runner.run('какие последние новости в мире инвестиций?', 's-news');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('market_news');
    // Подтверждение не запрашивается: публичные новости, не данные счёта.
    expect(result.approval).toBeUndefined();
    expect(result.answer).toContain('Новости инвестиционного рынка');
    // Пустые окна больше не печатаются: при одной нерелевантной новости ответ
    // честно говорит, что инвестиционных публикаций нет.
    expect(result.answer).toMatch(/Сегодня|За выбранный период/);
    expect(result.answer).toContain('Источники: tinkoff — получено');
    expect(result.report).toMatchObject({ type: 'market_news' });
    // Портфель не читается: ни одного вызова инструментов моделью.
    expect(toolCalls()).toBe(0);
  });

  it('портфель читается только после подтверждения', async () => {
    const { runner, toolCalls } = await createHarness([
      toolCall('call-1'),
      'В портфеле: SBER 100 шт., итог 152345.67 RUB.',
    ]);

    const awaiting = await runner.run('что у меня в портфеле?', 's-approve');
    expect(awaiting.status).toBe('awaiting_approval');
    // Сводку по всем счетам собирает локальный инструмент — одно подтверждение на прогон.
    expect(awaiting.approval?.actions[0]).toMatchObject({ tool: 'portfolio__snapshot' });
    expect(toolCalls()).toBe(0);

    const result = await runner.resume('s-approve', { approved: true });
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('SBER');
    // Цифры берутся из ответа брокера: 294.55 ₽ × 100 шт.
    expect(result.answer).toContain('294,55');
    expect(toolCalls()).toBe(1);
  });

  it('при отказе данные не читаются', async () => {
    const { runner, toolCalls } = await createHarness([
      toolCall('call-1'),
      'Данные портфеля не читал: вы отклонили запрос.',
    ]);

    const awaiting = await runner.run('покажи портфель', 's-decline');
    expect(awaiting.status).toBe('awaiting_approval');

    const result = await runner.resume('s-decline', { approved: false });

    expect(result.status).toBe('completed');
    expect(result.answer).toContain('не читал');
    expect(toolCalls()).toBe(0);
  });

  it('повторный вопрос о разборе в той же сессии снова требует подтверждения', async () => {
    const { runner } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
    ]);

    const first = await runner.run('проанализируй мой портфель', 's-strict');
    expect(first.status).toBe('awaiting_approval');
    await runner.resume('s-strict', { approved: true });

    const second = await runner.run('и ещё раз разбери портфель', 's-strict');
    expect(second.status).toBe('awaiting_approval');
  });

  it('разбор портфеля: один запрос подтверждения, отчёт по шаблону и сохранённый reportId', async () => {
    const { runner, moduleRef } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
    ]);

    const awaiting = await runner.run('проанализируй мой портфель', 's-review');
    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.approval?.question).toContain('разбора портфеля');
    expect(awaiting.approval?.actions[0]?.args).toMatchObject({ requests: expect.any(Number) });

    const result = await runner.resume('s-review', { approved: true });

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('portfolio_review');
    expect(result.report?.type).toBe('deep_review');
    expect(result.report?.coverage.some((entry) => entry.status === 'ok')).toBe(true);
    expect(result.answer).toContain('## Состав портфеля');
    expect(result.answer).toContain('SBER');
    // Сектор взят из справочника активов, а не «не определён».
    expect(result.answer).toContain('финансы');
    expect(result.answer).toContain('совет — добрать облигации');

    const stored = moduleRef
      .get(ReportStoreService)
      .get(result.report && 'reportId' in result.report ? result.report.reportId : '', 'default');
    expect(stored?.markdown).toContain('## Итог: диверсификация и стратегия');
    expect(stored?.templateVersion).toBe(3);
  });

  it('«стоит ли покупать Сбер» — это разбор бумаги, а не динамика цены', async () => {
    const { runner, toolCalls } = await createHarness([
      'Сбер: цена и прогноз ниже; решение — оценка, не рекомендация.',
    ]);

    const awaiting = await runner.run('стоит ли покупать Сбер?', 's-decision');

    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.intent).toBe('portfolio_review');
    expect(awaiting.scope).toBe('instrument');
    expect(awaiting.scopeTarget).toBe('SBER');
    // Портфель не читается: подтверждение относится к разбору бумаги.
    expect(toolCalls()).toBe(0);

    const result = await runner.resume('s-decision', { approved: true });

    expect(result.status).toBe('completed');
    expect(result.answer).toContain('Разбор бумаги SBER');
    expect(result.answer).toContain('цена за 1 шт.');
    expect(result.answer).toContain('финансы');
    expect(result.answer).toContain('Вывод по бумаге');
    // Ответ не должен быть одной строкой динамики за период.
    expect(result.answer).not.toContain('Динамика SBER за');
  });

  it('новый вопрос в той же сессии не получает прошлый отчёт', async () => {
    const { runner } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
      'Причина не установлена: по Яндексу и VK объяснений в публикациях нет, вот факты.',
    ]);

    const awaiting = await runner.run('проанализируй мой портфель', 's-cache');
    expect(awaiting.status).toBe('awaiting_approval');
    const report = await runner.resume('s-cache', { approved: true });
    expect(report.answer).toContain('## Состав портфеля');

    // Второй вопрос того же треда: отчёт прошлого прогона не должен «закешироваться».
    const second = await runner.run('почему упал яндекс, а vk взлетел за последнюю неделю', 's-cache');

    expect(second.status).toBe('completed');
    expect(second.intent).toBe('data_lookup');
    expect(second.answer).toContain('Яндекс');
    expect(second.answer).not.toContain('## Состав портфеля');
    expect(second.answer).not.toBe(report.answer);
  });

  it('динамика цены прошлого вопроса не отвечает на новый вопрос', async () => {
    const { runner, newsCalls } = await createHarness([
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call-dyn', name: 'market__price_dynamics', args: { ticker: 'SBER', days: 180 } },
        ],
      }),
      'Причина не установлена: по Яндексу публикаций с объяснением движения нет.',
    ]);

    // Динамика цены — публичные котировки: подтверждение для неё не требуется.
    const first = await runner.run('что с ценой сбер за полгода?', 's-dynamics');
    expect(first.status).toBe('completed');
    expect(first.answer).toContain('Динамика SBER');
    expect(newsCalls()).toBe(0);

    // Отчёт инструмента-агрегатора живёт в истории треда, но к новому вопросу
    // отношения не имеет: иначе на «почему упал Яндекс» приходит динамика Сбера.
    const second = await runner.run('почему упал яндекс?', 's-dynamics');

    expect(second.status).toBe('completed');
    expect(second.answer).toContain('Яндекс');
    expect(second.answer).not.toContain('Динамика SBER');
    // Вопрос о причине начинается со сбора публикаций: объяснять больше нечем.
    expect(newsCalls()).toBeGreaterThan(0);
  });
});
