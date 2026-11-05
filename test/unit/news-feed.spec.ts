import { NewsRegistry } from '../../src/news/news.registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/news/news.types.js';
import { collectNewsFeed, formatNewsFeed } from '../../src/tools/news-digest/news-digest.tool.js';
import { feedPeriodTitle } from '../../src/agent/nodes/news/index.js';

const NOW = new Date('2026-11-04T12:00:00Z');

const item = (title: string, daysAgo: number, source = 'rbc'): SourceItem => ({
  id: title,
  title,
  publishedAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  tags: [],
  source,
});

const adapter = (id: string, items: SourceItem[]): NewsSourceAdapter => ({
  id,
  topics: ['news'],
  fetchNews: async () => items,
});

const collect = (items: SourceItem[], maxPerPeriod = 5, sources?: NewsSourceAdapter[]) =>
  collectNewsFeed(new NewsRegistry(sources ?? [adapter('rbc', items)]), {
    pages: 1,
    maxItems: 50,
    maxPerPeriod,
    now: NOW,
  });

describe('сводка новостей рынка', () => {
  it('раскладывает публикации по четырём периодам', async () => {
    const feed = await collect([
      item('Акции выросли на торгах', 0),
      item('Ставка ЦБ снижена на заседании', 3),
      item('Дивиденды Лукойла утвердили', 20),
      item('Индекс Мосбиржи обновил максимум', 100),
      item('Слишком старая новость про акции', 400),
    ]);

    expect(feed.periods.map((period) => period.id)).toEqual([
      'today',
      'week',
      'month',
      'half_year',
    ]);
    expect(feed.periods[0].items.map((entry) => entry.title)).toEqual([
      'Акции выросли на торгах',
    ]);
    expect(feed.periods[1].items.map((entry) => entry.title)).toEqual([
      'Ставка ЦБ снижена на заседании',
    ]);
    expect(feed.periods[2].items.map((entry) => entry.title)).toEqual([
      'Дивиденды Лукойла утвердили',
    ]);
    expect(feed.periods[3].items.map((entry) => entry.title)).toEqual([
      'Индекс Мосбиржи обновил максимум',
    ]);
  });

  it('не повторяет публикацию в старших периодах', async () => {
    const feed = await collect([item('Отчётность банка вышла', 2)]);

    expect(feed.periods[0].items).toHaveLength(0);
    expect(feed.periods[1].items).toHaveLength(1);
    expect(feed.periods[2].items).toHaveLength(0);
    expect(feed.periods[3].items).toHaveLength(0);
  });

  it('отбрасывает дайджесты и нерелевантную повестку', async () => {
    const feed = await collect([
      item('Утренняя сводка новостей', 0),
      item('Российский теннисист вышел в финал', 0),
      item('Дирижер Герберт Блумстедт умер на 100-м году жизни', 0),
      item('ЦБ сохранил ключевую ставку', 0),
    ]);

    expect(feed.periods[0].items.map((entry) => entry.title)).toEqual([
      'ЦБ сохранил ключевую ставку',
    ]);
  });

  it('ограничивает число публикаций в периоде', async () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      item(`Акции эмитента ${index} выросли`, 2, `s${index}`),
    );
    const feed = await collect(many, 3);

    expect(feed.periods[1].items).toHaveLength(3);
  });

  it('не отдаёт весь период одному источнику', async () => {
    const many = [
      item('Акции выросли на торгах', 2, 'rbc'),
      item('Рынок акций обновил максимум', 2, 'rbc'),
      item('Дивиденды компании утвердили', 2, 'rbc'),
      item('Индекс Мосбиржи вырос', 2, 'bcs'),
    ];
    const feed = await collect(many, 4);
    const sources = feed.periods[1].items.map((entry) => entry.source);

    expect(sources.filter((source) => source === 'rbc').length).toBeLessThanOrEqual(2);
    expect(sources).toContain('bcs');
  });

  it('свежие публикации идут выше', async () => {
    const feed = await collect([
      item('Акции выросли пять дней назад', 5),
      item('Акции выросли три дня назад', 3),
    ]);
    const week = feed.periods[1].items.map((entry) => entry.title);

    expect(week[0]).toBe('Акции выросли три дня назад');
  });

  it('показывает пустой период и покрытие источников', async () => {
    const feed = await collect([item('Акции выросли на торгах', 0)]);
    const text = formatNewsFeed(feed);

    expect(text).toContain('Новости инвестиционного рынка');
    expect(text).toContain('Сегодня');
    expect(text).toContain('За месяц');
    expect(text).toContain('• новостей нет');
    expect(text).toContain('Источники: rbc — получено (1)');
    expect(text).toContain('Данные обновлены:');
  });

  it('отказ одного источника не ломает сводку', async () => {
    const broken: NewsSourceAdapter = {
      id: 'bcs',
      topics: ['news'],
      fetchNews: async () => {
        throw new Error('HTTP 429');
      },
    };
    const feed = await collect([item('Акции выросли на торгах', 0)], 5, [
      adapter('rbc', [item('Акции выросли на торгах', 0)]),
      broken,
    ]);
    const text = formatNewsFeed(feed);

    expect(feed.periods[0].items).toHaveLength(1);
    expect(feed.coverage.find((entry) => entry.source === 'bcs')).toMatchObject({
      status: 'missing',
      reason: 'HTTP 429',
    });
    expect(text).toContain('bcs — недоступен (HTTP 429)');
  });

  it('подписывает произвольный период числом дней', () => {
    expect(feedPeriodTitle(1)).toBe('Сегодня');
    expect(feedPeriodTitle(7)).toBe('За неделю');
    expect(feedPeriodTitle(30)).toBe('За месяц');
    expect(feedPeriodTitle(180)).toBe('За полгода');
    expect(feedPeriodTitle(14)).toBe('За 14 дней');
  });
});
