import {
  EMPTY_PROFILES,
  companyProfileOf,
  sectorLabel,
  sectorProfileOf,
  type CompanyProfiles,
} from '../reports/index.js';

/**
 * Поиск причин по факторам, а не только по названию бумаги.
 *
 * В заголовке «Лукойл вырос» причины нет — она в публикациях про нефть, курс и
 * санкции. Факторы берутся из профилей: драйверы сектора бумаги плюс общие
 * рыночные. Это данные (`data/company-profiles.yaml`), а не код.
 */
export interface FactorQuery {
  /** Подпись фактора для ответа. */
  title: string;
  /** Подстроки для поиска публикаций: «нефть», «Brent», «санкц». */
  keywords: string[];
  /** Вес фактора: драйвер сектора важнее общего рыночного. */
  weight: number;
}

/** Факторы вопроса о причинах: драйверы сектора бумаги и общие рыночные. */
export const factorsFor = (
  ticker: string | undefined,
  profiles: CompanyProfiles = EMPTY_PROFILES,
): FactorQuery[] => {
  const queries: FactorQuery[] = [];
  const company = companyProfileOf(profiles, ticker);
  const sector = sectorProfileOf(profiles, company?.sector);
  if (sector && sector.factors.length > 0) {
    queries.push({
      title: `драйверы сектора «${sectorLabel(sector.key)}»`,
      keywords: sector.factors,
      // Сектор объясняет движение конкретной бумаги лучше, чем общий рынок.
      weight: 2,
    });
  }
  for (const factor of profiles.marketFactors) {
    queries.push({ title: factor.title, keywords: factor.keywords, weight: 1 });
  }
  return queries;
};

/** Вес ключа: конкретная формулировка важнее короткой подстроки. */
const keywordWeight = (keyword: string): number => {
  const length = keyword.trim().length;
  return length >= 8 ? 3 : length >= 5 ? 2 : 1;
};

/** Минимальный вес совпадения: одна короткая подстрока («рубл») — ещё не фактор. */
const MIN_FACTOR_SCORE = 2;

/**
 * Публикации, упоминающие факторы.
 *
 * Совпадение ищется по заголовку: аннотации часто содержат «миллиарды долларов»
 * или «млрд рублей», и по ним в факторы попадал любой бюджетный сюжет. Счёт —
 * сумма весов ключей, умноженная на вес фактора: драйвер сектора объясняет
 * движение бумаги лучше общего рынка. Сначала сильное совпадение, затем свежесть.
 */
export const matchFactors = <
  T extends { title: string; summary?: string; publishedAt: string },
>(
  items: readonly T[],
  queries: readonly FactorQuery[],
): { item: T; matched: string[]; score: number }[] =>
  items
    .map((item) => {
      const title = item.title.toLowerCase();
      const hits = queries.flatMap((query) =>
        query.keywords
          .filter((keyword) => title.includes(keyword.toLowerCase()))
          .map((keyword) => ({ title: query.title, weight: keywordWeight(keyword) * query.weight })),
      );
      const score = hits.reduce((sum, hit) => sum + hit.weight, 0);
      return { item, matched: [...new Set(hits.map((hit) => hit.title))], score };
    })
    .filter((entry) => entry.score >= MIN_FACTOR_SCORE)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.item.publishedAt.localeCompare(left.item.publishedAt);
    });
