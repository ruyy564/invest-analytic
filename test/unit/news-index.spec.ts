import { NewsIndex, storedId, toStored } from '../../src/capabilities/news/store/news-index.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

const item = (title: string, publishedAt: string, tickers: string[] = []) =>
  toStored(
    {
      id: title,
      title,
      summary: `аннотация: ${title}`,
      url: `https://example.com/${encodeURIComponent(title)}`,
      publishedAt,
      tags: [],
      source: 'test',
    },
    { tickers, now: NOW },
  );

describe('индекс новостей', () => {
  it('хранит публикации и отдаёт их по тикеру', () => {
    const index = new NewsIndex(':memory:');
    index.save([item('Лукойл вырос', daysAgo(2), ['LKOH']), item('Нефть подорожала', daysAgo(1))]);

    const found = index.search({ tickers: ['lkoh'], sinceDays: 30 }, NOW);

    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Лукойл вырос');
    index.close();
  });

  it('ищет по ключевым словам и соблюдает окно', () => {
    const index = new NewsIndex(':memory:');
    index.save([
      item('Brent поднялась выше 113', daysAgo(5)),
      item('Нефть подешевела', daysAgo(60)),
    ]);

    expect(index.search({ keywords: ['brent'], sinceDays: 30 }, NOW)).toHaveLength(1);
    // Окно 30 дней отсекает старую публикацию, окно 90 — находит.
    expect(index.search({ keywords: ['нефть'], sinceDays: 30 }, NOW)).toHaveLength(0);
    expect(index.search({ keywords: ['нефть'], sinceDays: 90 }, NOW)).toHaveLength(1);
    index.close();
  });

  it('объединяет привязки к тикерам при повторной записи', () => {
    const index = new NewsIndex(':memory:');
    const news = item('Санкции и нефть', daysAgo(1), ['LKOH']);
    index.save([news]);
    index.save([{ ...news, tickers: ['ROSN'] }], NOW);

    expect(index.search({ tickers: ['LKOH'] }, NOW)).toHaveLength(1);
    expect(index.search({ tickers: ['ROSN'] }, NOW)).toHaveLength(1);
    index.close();
  });

  it('помнит текст статьи по ссылке', () => {
    const index = new NewsIndex(':memory:');
    index.saveText('https://example.com/a', 'Текст статьи про нефть');

    expect(index.textOf('https://example.com/a')).toBe('Текст статьи про нефть');
    expect(index.textOf('https://example.com/b')).toBeUndefined();
    index.close();
  });

  it('удаляет старое по сроку хранения', () => {
    const index = new NewsIndex(':memory:');
    index.save([item('Свежая', daysAgo(1)), item('Старая', daysAgo(40))]);

    expect(index.prune(30, NOW)).toBe(1);
    expect(index.search({ sinceDays: 90 }, NOW).map((entry) => entry.title)).toEqual(['Свежая']);
    index.close();
  });

  it('ключ публикации — ссылка, иначе заголовок', () => {
    expect(storedId({ title: 'Заголовок', url: 'https://a/1' })).toBe('https://a/1');
    expect(storedId({ title: '  Заголовок  ' })).toBe('заголовок');
  });
});
