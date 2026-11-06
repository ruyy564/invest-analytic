import { readFileSync } from 'node:fs';
import { parseFeed } from '../../src/shared/parsing/feed.js';
import { mapNews } from '../../src/capabilities/news/sources/tinkoff.js';
import { parseRbcQuote } from '../../src/capabilities/news/sources/rbc-quote.js';
import { parseTbankResearch } from '../../src/capabilities/news/sources/tbank-research.js';

const golden = (name: string): string => readFileSync(`test/fixtures/golden/${name}`, 'utf8');

describe('контракт источников: golden-файлы', () => {
  it('разбирает RSS-ленту в ожидаемые элементы', () => {
    const items = parseFeed(golden('interfax.rss'), { format: 'rss', source: 'interfax' });

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: 'Индекс Мосбиржи вырос на 1,2 %',
      url: 'https://example.test/news/1',
      source: 'interfax',
    });
    expect(items[0].publishedAt).toBe('2026-11-05T06:00:00.000Z');
    expect(items[0].tags).toEqual(['рынок']);
  });

  it('разбирает ответ брокера и отбрасывает общие итоги торгов', () => {
    const raw = JSON.parse(golden('tinkoff-news.json')) as unknown;

    const { items, nextCursor } = mapNews(raw, 'tinkoff', 400, ['ЛУКОЙЛ', 'LKOH']);

    expect(items.map((item) => item.id)).toEqual(['t-1']);
    expect(items[0].instrumentTags).toEqual(['LKOH']);
    expect(nextCursor).toBe('cursor-2');
  });

  it('разбирает SSR-состояние РБК и не берёт общий обзор', () => {
    const items = parseRbcQuote(golden('rbc-quote.html'));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Сбербанк нарастил прибыль',
      instrumentTags: ['SBER'],
      source: 'rbc_quote',
    });
  });

  it('разбирает идеи Т-Инвестиций', () => {
    const items = parseTbankResearch(golden('tbank-research.html'));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Татнефть — все еще фаворит сектора',
      instrumentTags: ['TATN'],
      source: 'tbank_research',
    });
  });
});
