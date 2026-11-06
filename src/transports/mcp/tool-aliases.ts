/**
 * Старые имена инструментов, которые остаются рабочими на время миграции.
 * Новые имена — доменные фасады (`portfolio__snapshot`, `market__price_dynamics`).
 */
export const DEPRECATED_ALIASES: Readonly<Record<string, string>> = {
  portfolio_all_accounts: 'portfolio__snapshot',
  price_dynamics: 'market__price_dynamics',
};

/** Какие устаревшие имена присутствуют в каталоге: повод для предупреждения. */
export const deprecatedAliasesPresent = (names: readonly string[]): string[] =>
  Object.keys(DEPRECATED_ALIASES).filter((alias) => names.includes(alias));

/** Человекочитаемая подсказка: какое имя использовать вместо старого. */
export const aliasHint = (alias: string): string =>
  `«${alias}» устарел, используйте «${DEPRECATED_ALIASES[alias] ?? alias}»`;
