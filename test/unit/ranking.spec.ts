import { rankByQuery, termsOf } from '../../src/capabilities/news/store/ranking.js';

const ITEMS = [
  { title: 'Лукойл отчитался за квартал', publishedAt: '2026-11-06T00:00:00Z' },
  {
    title: 'Нефть Brent подорожала',
    summary: 'Цены на нефть выросли третью неделю',
    publishedAt: '2026-11-05T00:00:00Z',
  },
  { title: 'Курс доллара снизился', publishedAt: '2026-11-07T00:00:00Z' },
];

describe('ранжирование под вопрос', () => {
  it('отбрасывает служебные слова и берёт основы', () => {
    expect(termsOf('почему вырос Лукойл?')).toEqual(['вырос', 'лукой']);
    expect(termsOf('как оно')).toEqual([]);
  });

  it('ставит сверху публикации по словам вопроса', () => {
    const ranked = rankByQuery(ITEMS, 'почему подорожала нефть?');

    expect(ranked[0].title).toContain('Нефть');
  });

  it('ничего не выбрасывает: нерелевантные остаются в конце', () => {
    expect(rankByQuery(ITEMS, 'санкции')).toHaveLength(3);
  });

  it('заголовок весит больше аннотации', () => {
    const items = [
      {
        title: 'Обзор рынка',
        summary: 'нефть подорожала за неделю',
        publishedAt: '2026-11-07T00:00:00Z',
      },
      { title: 'Нефть подорожала', publishedAt: '2026-11-01T00:00:00Z' },
    ];

    expect(rankByQuery(items, 'нефть')[0].title).toBe('Нефть подорожала');
  });
});
