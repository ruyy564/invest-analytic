import { resultsInGroup } from '../../collection/executor.js';
import { isBondClass } from '../../collection/plan.js';
import { formatNumber } from '../../portfolio-report.js';
import type { FactContext } from '../../engine.js';

export type BondCategory = 'ОФЗ' | 'корпоративная' | 'муниципальная' | 'замещающая';

/** Факты по облигации: категория, купон, погашение, оферта, НКД. */
export interface BondFacts {
  category: BondCategory;
  /** Сколько купонов в год платит бумага. */
  couponPerYear?: number;
  /** Оценка годовой купонной ставки, % (по накопленному доходу между выплатами). */
  couponPct?: number;
  maturityDate?: string;
  nextCouponDate?: string;
  offerDate?: string;
  accrued?: number;
  nominal?: { amount: number; currency: string };
  floating: boolean;
  amortized: boolean;
  perpetual: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const moneyOf = (value: unknown): number | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const raw = typeof record.value === 'string' ? Number(record.value) : undefined;
  return raw !== undefined && Number.isFinite(raw) ? raw : undefined;
};

const groupText = (ctx: FactContext, group: string, ticker: string): string | undefined =>
  resultsInGroup(ctx.plan, ctx.collected, group).find((entry) => entry.entry.target === ticker)?.text;

export { isBondClass };

const categoryOf = (
  ticker: string,
  classCode: string | undefined,
  nominalCurrency: string | undefined,
): BondCategory => {
  if (ticker.startsWith('SU') || classCode === 'TQOB' || classCode === 'PSAU') {
    return 'ОФЗ';
  }
  if (classCode === 'TQIR' || classCode === 'TQMO') {
    return 'муниципальная';
  }
  return nominalCurrency && nominalCurrency.toLowerCase() !== 'rub' ? 'замещающая' : 'корпоративная';
};

/**
 * Факты по облигации из трёх ответов брокера: карточка, календарь событий и НКД.
 * Ставка купона оценивается по максимуму накопленного дохода между выплатами:
 * точного поля со ставкой в ответе карточки нет.
 */
export const bondFactsOf = (
  ctx: FactContext,
  ticker: string,
  classCode?: string,
): BondFacts | undefined => {
  if (!isBondClass(classCode)) {
    return undefined;
  }
  const bondText = groupText(ctx, 'bonds', ticker);
  const bond = asRecord(asRecord(asJson(bondText ?? ''))?.instrument);
  if (!bond) {
    return undefined;
  }
  const nominalRecord = asRecord(bond.nominal);
  const nominalCurrency =
    typeof nominalRecord?.currency === 'string' ? nominalRecord.currency : undefined;
  const couponPerYear =
    typeof bond.couponQuantityPerYear === 'number' ? bond.couponQuantityPerYear : undefined;
  const today = ctx.now.toISOString().slice(0, 10);

  const events = asRecord(asJson(groupText(ctx, 'bond_events', ticker) ?? ''))?.events;
  const eventList = Array.isArray(events) ? events.map(asRecord).filter((item) => item !== undefined) : [];
  const nextOf = (type: string): string | undefined =>
    eventList
      .filter((event) => String(event.eventType ?? '').includes(type))
      .map((event) => String(event.eventDate ?? ''))
      .filter((date) => date.length > 0 && date >= today)
      .sort()[0];

  const accruedList = asRecord(asJson(groupText(ctx, 'bond_accrued', ticker) ?? ''))?.accruedInterests;
  const accrued = Array.isArray(accruedList)
    ? accruedList
        .map(asRecord)
        .filter((item) => item !== undefined)
        .map((item) => Number(asRecord(item.valuePercent)?.value))
        .filter((value) => Number.isFinite(value))
    : [];
  // Максимум накопленного процента между выплатами ≈ купон за период.
  const couponPeriodPct = accrued.length > 0 ? Math.max(...accrued) : undefined;

  return {
    category: categoryOf(ticker, classCode, nominalCurrency),
    couponPerYear,
    couponPct:
      couponPeriodPct !== undefined && couponPerYear !== undefined
        ? couponPeriodPct * couponPerYear
        : undefined,
    maturityDate: typeof bond.maturityDate === 'string' ? bond.maturityDate : nextOf('MATURITY'),
    nextCouponDate: nextOf('CPN'),
    offerDate: nextOf('OFFER'),
    accrued: moneyOf(bond.aciValue),
    nominal:
      nominalRecord && moneyOf(nominalRecord) !== undefined
        ? { amount: moneyOf(nominalRecord) as number, currency: nominalCurrency ?? 'rub' }
        : undefined,
    floating: bond.floatingCouponFlag === true,
    amortized: bond.amortizationFlag === true,
    perpetual: bond.perpetualFlag === true,
  };
};

/** Строка облигации для карточки бумаги. */
export const bondLine = (facts: BondFacts): string => {
  const parts: string[] = [];
  if (facts.couponPerYear !== undefined) {
    parts.push(`купон ${facts.couponPerYear} раз в год`);
  }
  if (facts.couponPct !== undefined) {
    parts.push(`ставка около ${formatNumber(facts.couponPct)} % годовых (оценка)`);
  }
  if (facts.floating) {
    parts.push('плавающий купон');
  }
  if (facts.amortized) {
    parts.push('с амортизацией');
  }
  if (facts.perpetual) {
    parts.push('бессрочная');
  }
  if (facts.maturityDate) {
    parts.push(`погашение ${facts.maturityDate}`);
  }
  if (facts.offerDate) {
    parts.push(`оферта ${facts.offerDate}`);
  }
  if (facts.nextCouponDate) {
    parts.push(`ближайший купон ${facts.nextCouponDate}`);
  }
  if (facts.accrued !== undefined) {
    parts.push(`НКД ${formatNumber(facts.accrued)} ${(facts.nominal?.currency ?? 'RUB').toUpperCase()}`);
  }
  return `• облигация: ${facts.category}${parts.length > 0 ? `, ${parts.join(', ')}` : ''}`;
};