import { instrumentKey, type PlanEntry, type PlanGroup } from './plan.js';
import { assetUidOf, brandUidOf } from '../sector.js';

/**
 * Справочник секторов: у брокера сектор лежит в бренде, а путь до него —
 * три запроса. Проверено на живом MCP:
 *   1) `invest_get_share` (responseView FULL) отдаёт `instrument.assetUid`;
 *   2) `invest_get_asset` по uid актива отдаёт `asset.brand.uid`;
 *   3) `invest_get_brand` по uid бренда отдаёт `sector` (например, `financial`).
 */

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const reference = (tool: string, args: Record<string, unknown>, ticker: string): PlanEntry => ({
  tool,
  args,
  group: 'reference' as PlanGroup,
  priority: 'optional',
  target: ticker,
});

/** Шаг 1: бумага → uid актива. */
export const shareEntries = (
  instruments: readonly { ticker: string; classCode?: string }[],
): PlanEntry[] =>
  instruments.map((instrument) =>
    reference(
      'invest_get_share',
      {
        instrumentId: instrumentKey(instrument.ticker, instrument.classCode),
        idType: 'INSTRUMENT_ID_TYPE_ID',
        // BASE отдаёт только тикер и имя — uid актива приходит в FULL.
        responseView: ['FULL'],
      },
      instrument.ticker,
    ),
  );

/** Шаг 2: uid актива → карточка актива (в ней uid бренда). */
export const assetEntries = (
  shares: readonly PlanEntry[],
  texts: ReadonlyMap<string, string>,
  keyOf: (entry: PlanEntry) => string,
): PlanEntry[] =>
  shares.flatMap((entry) => {
    const text = texts.get(keyOf(entry));
    const assetUid = text ? assetUidOf(asJson(text)) : undefined;
    return assetUid && entry.target
      ? [reference('invest_get_asset', { id: assetUid }, entry.target)]
      : [];
  });

/** Шаг 3: uid бренда → карточка бренда (в ней сектор). */
export const brandEntries = (
  assets: readonly PlanEntry[],
  texts: ReadonlyMap<string, string>,
  keyOf: (entry: PlanEntry) => string,
): PlanEntry[] =>
  assets.flatMap((entry) => {
    const text = texts.get(keyOf(entry));
    const brandUid = text ? brandUidOf(asJson(text)) : undefined;
    return brandUid && entry.target
      ? [reference('invest_get_brand', { id: brandUid }, entry.target)]
      : [];
  });
