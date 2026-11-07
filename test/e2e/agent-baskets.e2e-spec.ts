import { join } from 'node:path';
import { loadEvalCases } from '../../src/eval/case-schema.js';
import { gradeAnswer } from '../../src/eval/graders.js';
import { HARNESS_ENV, createHarness } from '../fixtures/agent-harness.js';

/**
 * Корзина поведения: реальный граф на фейковом MCP и скриптовой модели.
 * Проверяется итоговое состояние ответа, а не путь к нему: заголовок темы,
 * наличие чисел по рынку, структура аналитики.
 */

const NOW = new Date().toISOString();

const newsItems = (items: { title: string; content: string }[]) => ({
  items: items.map((item, index) => ({ id: `n${index}`, ts: NOW, ...item })),
  hasNext: false,
});

const basketCase = (id: string) => {
  const cases = loadEvalCases(join(import.meta.dirname, '..', 'eval', 'cases', 'analytics.json'));
  const found = cases.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`кейс ${id} не найден в корзине аналитики`);
  }
  return found;
};

describe('корзина поведения', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, HARNESS_ENV);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('новости по теме: криптовалюты без спорта и криминала', async () => {
    const { runner } = await createHarness(['ответ не используется'], {
      news: () =>
        newsItems([
          { title: 'Биткоин вырос до 76 000 долларов', content: 'Криптовалюты отскочили' },
          { title: 'Фигуристы выиграли золото на Гран-при', content: 'Спорт' },
          { title: 'Мошенники похитили 450 млн рублей', content: 'Криминал' },
          { title: 'Акции банков выросли на торгах', content: 'Рынок' },
        ]),
    });

    const result = await runner.run('какие новости по криптовалютам?', 'basket-crypto');

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('market_news');
    expect(result.answer).toContain('Новости: криптовалюты');
    expect(result.answer).toContain('Биткоин');
    expect(result.answer).not.toContain('Фигуристы');
    expect(result.answer).not.toContain('Мошенники');
  });

  it('вопрос о причине: модели приходят числа по рынку и публикации', async () => {
    const { runner, modelInputs } = await createHarness(
      ['Лукойл вырос на фоне дорожающей нефти — публикация от 2026-11-07, tinkoff.'],
      {
        news: () =>
          newsItems([
            { title: 'Лукойл вырос на фоне дорожающей нефти', content: 'Нефть дорожает' },
          ]),
      },
    );

    const result = await runner.run('почему вырос лукойл?', 'basket-cause');

    expect(result.status).toBe('completed');
    const prompt = modelInputs().at(-1) ?? '';
    // Числа по рынку и публикации должны быть в контексте модели, а не только в ответе.
    expect(prompt).toContain('Рыночные факторы');
    expect(prompt).toContain('Лукойл');
  });

  it('разбор бумаги проходит корзину аналитики', async () => {
    // Грейдеры корзины: разделы, числа, отсутствие одиночной динамики цены.
    const cases = ['analytics-instrument-sber', 'analytics-portfolio'] as const;
    const { runner } = await createHarness([
      'macro: ставка 14 % (оценка).\nverdict: совет — добрать облигации.',
    ]);

    const awaiting = await runner.run('стоит ли покупать Сбер?', 'basket-review-sber');
    expect(awaiting.status).toBe('awaiting_approval');
    const result = await runner.resume('basket-review-sber', { approved: true });
    const answer = String(result.answer);

    const failed = gradeAnswer(basketCase(cases[0]), answer).filter((grader) => !grader.passed);
    expect(failed).toEqual([]);
  });

  it('в разборе бумаги есть блоки «что влияет», «хорошо/плохо» и «чего ждём»', async () => {
    const { runner } = await createHarness(['ответ модели не используется']);

    const awaiting = await runner.run('разбери Сбер: что влияет и чего ждём', 'basket-brief-sber');
    expect(awaiting.status).toBe('awaiting_approval');
    const result = await runner.resume('basket-brief-sber', { approved: true });
    const answer = String(result.answer);

    // Блоки считает код: заголовки и числа не зависят от ответа модели.
    expect(answer).toContain('## Что влияет на бумагу');
    expect(answer).toContain('## Хорошо, нейтрально, плохо');
    expect(answer).toContain('## Чего ждём');
    expect(answer).toContain('Драйверы сектора');
    expect(answer).toContain('Мнение аналитиков: хорошо');
    expect(answer).toContain('Заседание ЦБ');
    // Ставка в стенде выключена (`KEY_RATE_SOURCE_MODE=off`), поэтому её строки
    // нет; в офлайн-транскрипте корзины она есть — там источник включён.
    // Разделы и вердикты проверяет грейдер корзины «Разбор бумаги».
    expect(answer).toContain('Рентабельность капитала');
  });
});
