import type { SourceCoverageEntry } from '../../../news/index.js';
import { formatNumber } from '../../../reports/index.js';
import { METAL_LABELS } from '../../commodities/commodity.links.js';
import type { CommoditySnapshot, CommoditySource } from '../../commodities/commodity.types.js';

export const COMMODITY_TOOL = 'macro__commodities';

export interface CommodityResult {
  snapshot?: CommoditySnapshot;
  coverage: SourceCoverageEntry;
  asOf: string;
}

/** Учётные цены драгметаллов ЦБ и покрытие источника. */
export const collectCommodities = async (
  source: CommoditySource | undefined,
  now: Date = new Date(),
): Promise<CommodityResult> => {
  if (!source) {
    return {
      coverage: { source: 'cbr', status: 'missing', reason: 'источник цен металлов не подключён' },
      asOf: now.toISOString(),
    };
  }
  try {
    const snapshot = await source.read();
    return {
      snapshot,
      coverage: snapshot
        ? { source: 'cbr', status: 'ok', items: snapshot.quotes.length }
        : { source: 'cbr', status: 'missing', reason: 'ЦБ не вернул котировки' },
      asOf: now.toISOString(),
    };
  } catch (error) {
    return {
      coverage: {
        source: 'cbr',
        status: 'missing',
        reason: (error as Error)?.message ?? 'ошибка источника',
      },
      asOf: now.toISOString(),
    };
  }
};

/** Текст ответа: цены металлов за грамм на последнюю дату котировки. */
export const formatCommodities = (result: CommodityResult): string => {
  const snapshot = result.snapshot;
  if (!snapshot || snapshot.quotes.length === 0) {
    return `Цены металлов недоступны: ${result.coverage.reason ?? 'ЦБ не ответил'}.`;
  }
  const date = snapshot.quotes[0]?.date ?? result.asOf.slice(0, 10);
  return [
    `Учётные цены драгметаллов ЦБ на ${date} (RUB за грамм):`,
    ...snapshot.quotes.map(
      (quote) => `• ${METAL_LABELS[quote.metal]}: ${formatNumber(quote.price)} ₽/г (${quote.date})`,
    ),
  ].join('\n');
};
