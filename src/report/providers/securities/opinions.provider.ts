import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { formatChangePct, type PeriodChange } from '../../market-facts.js';
import { formatPercent } from '../../renderers.js';
import { noHoldingsReason, securitiesOf, type SecurityFacts } from './shared.js';

/**
 * Выжимка для модели: по каждой бумаге — сектор, доля, динамика и потенциал,
 * по секторам — доля и средневзвешенное движение за 180 дней. Модель оценивает
 * бумаги и секторы, не выдумывая числа.
 */
export const opinionsProvider: FactProvider = {
  id: 'securities.opinions',
  section(ctx: FactContext): SectionFacts | undefined {
    const securities = securitiesOf(ctx);
    if (securities.length === 0) {
      return { missing: noHoldingsReason(ctx) };
    }

    const longest = (security: SecurityFacts): PeriodChange | undefined =>
      security.periods.find((change) => change.period === '180d') ?? security.periods.at(-1);

    const sectors = new Map<string, { share: number; weighted: number; weight: number }>();
    for (const security of securities) {
      const change = longest(security);
      const bucket = sectors.get(security.sector) ?? { share: 0, weighted: 0, weight: 0 };
      bucket.share += security.share;
      if (change && security.value !== undefined) {
        bucket.weighted += change.changePct * security.value;
        bucket.weight += security.value;
      }
      sectors.set(security.sector, bucket);
    }

    const perSecurity = securities.map((security) => {
      const change = longest(security);
      return [
        `${security.ticker} (${security.sector}, ${formatPercent(security.share)}`,
        change ? `, ${change.label} ${formatChangePct(change.changePct)}` : ', динамики нет',
        security.forecast?.upside !== undefined
          ? `, потенциал ${formatChangePct(security.forecast.upside)}`
          : ', потенциала нет',
        `, новостей ${security.news.length})`,
      ].join('');
    });

    const perSector = [...sectors.entries()].map(([name, bucket]) =>
      bucket.weight > 0
        ? `${name} ${formatPercent(bucket.share)} (180 дней ${formatChangePct(
            bucket.weighted / bucket.weight,
          )})`
        : `${name} ${formatPercent(bucket.share)} (динамики нет)`,
    );

    return {
      markdown: [
        `Бумаги: ${perSecurity.join('; ')}`,
        `Секторы: ${perSector.join('; ')}`,
      ].join('\n'),
      structured: { perSecurity, perSector },
      brief: [`бумаги: ${perSecurity.join('; ')}`, `секторы: ${perSector.join('; ')}`]
        .join(' | ')
        .slice(0, 2_000),
    };
  },
};
