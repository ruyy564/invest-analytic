import { NewsRegistry } from '../../src/capabilities/news/news.registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/capabilities/news/news.types.js';
import { isOffTopicTitle } from '../../src/capabilities/news/news.filters.js';
import { collectNewsFeed, formatNewsFeed } from '../../src/capabilities/news/tools/news-digest/news-digest.service.js';
import { matchesMatchers, topicOf } from '../../src/capabilities/news/topics.js';
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

const collectTopic = (items: SourceItem[], topic: readonly string[]) =>
  collectNewsFeed(new NewsRegistry([adapter('crypto-forklog', items)]), {
    pages: 1,
    maxItems: 50,
    maxPerPeriod: 5,
    topic,
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

  it('скрывает пустые периоды и показывает покрытие источников', async () => {
    const feed = await collect([item('Акции выросли на торгах', 0)]);
    const text = formatNewsFeed(feed);

    expect(text).toContain('Новости инвестиционного рынка');
    expect(text).toContain('Сегодня');
    // Пустые окна (неделя/месяц/полгода) в ответ не попадают: они только шумят.
    expect(text).not.toContain('За месяц');
    expect(text).not.toContain('• новостей нет');
    expect(text).toContain('Источники: rbc — получено (1)');
    expect(text).toContain('Данные обновлены:');
  });

  it('без единой публикации пишет одну строку вместо пустых окон', async () => {
    const feed = await collect([]);
    const text = formatNewsFeed(feed);

    expect(text).toContain('За выбранный период инвестиционных новостей нет.');
    expect(text).not.toContain('Сегодня');
  });

  it('отсекает «акции» вне инвестиционной повестки', () => {
    expect(
      isOffTopicTitle('Львова-Белова анонсировала новую акцию по возвращению детей на Украину'),
    ).toBe(true);
    expect(isOffTopicTitle('Акции «Полюса» выросли на 3 %')).toBe(false);
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

describe('тематическая сводка', () => {
  it('определяет тему вопроса', () => {
    expect(topicOf('какие новости по криптовалютам?')?.id).toBe('crypto');
    expect(topicOf('что нового по нефти')?.id).toBe('oil');
    expect(topicOf('какие последние новости в мире инвестиций?')).toBeUndefined();
  });

  it('латинские слова ищутся целыми', () => {
    expect(topicOf('новости ETH')?.id).toBe('crypto');
    // «method» не должна считаться эфириумом по подстроке «eth».
    expect(topicOf('method')).toBeUndefined();
  });

  it('оставляет только публикации темы', async () => {
    const feed = await collectTopic(
      [
        item('Биткоин вырос до $76 000', 0),
        item('Фигуристы выиграли золото', 0),
        item('Мошенники похитили 450 млн рублей', 0),
        item('Акции банков выросли', 0),
      ],
      ['крипт', 'биткоин', 'btc', 'блокчейн'],
    );

    expect(feed.periods.flatMap((period) => period.items).map((entry) => entry.title)).toEqual([
      'Биткоин вырос до $76 000',
    ]);
    expect(formatNewsFeed(feed, 'криптовалюты')).toContain('Новости: криптовалюты');
  });

  it('пустая тема говорит об этом прямо', async () => {
    const feed = await collectTopic([item('Биткоин вырос', 0)], ['облигации']);

    expect(formatNewsFeed(feed, 'облигации')).toContain(
      'За выбранный период публикаций по теме «облигации» нет.',
    );
  });

  it('спорт и криминал отбрасываются как посторонние', () => {
    expect(
      isOffTopicTitle('Мишина и Галлямов завоевали золотые медали в парном катании'),
    ).toBe(true);
    expect(isOffTopicTitle('Мошенники похитили у жительницы Москвы 450 млн рублей')).toBe(true);
    expect(isOffTopicTitle('ЦБ сохранил ключевую ставку')).toBe(false);
  });

  it('совпадение по теме проверяет заголовок и аннотацию', () => {
    expect(
      matchesMatchers({ title: 'Рынок вырос', summary: 'биткоин обновил максимум' }, ['биткоин']),
    ).toBe(true);
    expect(matchesMatchers({ title: 'Рынок вырос' }, ['биткоин'])).toBe(false);
  });
});

});
