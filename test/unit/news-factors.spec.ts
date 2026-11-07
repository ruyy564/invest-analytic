import { loadCompanyProfiles } from '../../src/capabilities/reports/index.js';
import { factorsFor, matchFactors } from '../../src/capabilities/news/index.js';

const PROFILES = loadCompanyProfiles('data/company-profiles.yaml');

describe('факторы поиска причин', () => {
  it('берёт драйверы сектора бумаги и общие рыночные факторы', () => {
    const queries = factorsFor('LKOH', PROFILES);

    expect(queries[0]?.title).toContain('нефть и газ');
    expect(queries[0]?.keywords).toEqual(expect.arrayContaining(['нефть', 'Brent']));
    expect(queries.map((query) => query.title)).toEqual(
      expect.arrayContaining(['курс рубля', 'санкции и регулирование']),
    );
  });

  it('для бумаги вне профилей оставляет общие факторы', () => {
    const queries = factorsFor('XXXX', PROFILES);

    expect(queries).toHaveLength(PROFILES.marketFactors.length);
  });

  it('ставит выше публикации, где совпало больше факторов', () => {
    const queries = factorsFor('LKOH', PROFILES);
    const items = [
      {
        title: 'Нефть подорожала, доллар вырос, санкции обсудили',
        publishedAt: '2026-11-01T00:00:00Z',
      },
      { title: 'Санкции против эмитента', publishedAt: '2026-11-05T00:00:00Z' },
      { title: 'Спорт и погода', publishedAt: '2026-11-06T00:00:00Z' },
    ];

    const matched = matchFactors(items, queries);

    expect(matched).toHaveLength(2);
    expect(matched[0].item.title).toContain('Нефть подорожала');
    expect(matched[0].matched.length).toBeGreaterThan(1);
  });
});
