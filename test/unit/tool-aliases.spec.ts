import { aliasHint, deprecatedAliasesPresent } from '../../src/mcp/tool-aliases.js';

describe('устаревшие имена инструментов', () => {
  it('находит старые имена в каталоге', () => {
    expect(
      deprecatedAliasesPresent(['portfolio__snapshot', 'portfolio_all_accounts', 'price_dynamics']),
    ).toEqual(['portfolio_all_accounts', 'price_dynamics']);
    expect(deprecatedAliasesPresent(['instruments__prices', 'news__search'])).toEqual([]);
  });

  it('подсказывает новое имя вместо старого', () => {
    expect(aliasHint('portfolio_all_accounts')).toContain('portfolio__snapshot');
    expect(aliasHint('price_dynamics')).toContain('market__price_dynamics');
  });
});
