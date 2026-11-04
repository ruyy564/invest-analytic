/**
 * Секторы отдаёт бренд актива, поэтому путь до них — три запроса
 * (`share → asset → brand`); он собран в `reference.ts`.
 * Здесь остаётся разбор ответов и честный фолбэк «не определён».
 */

/** Человекочитаемые названия секторов T-Invest API. */
export const SECTOR_LABELS: Record<string, string> = {
  SECTOR_FINANCIAL: 'финансы',
  SECTOR_CONSUMER_GOODS: 'потребительские товары',
  SECTOR_HEALTH_CARE: 'здравоохранение',
  SECTOR_MATERIALS: 'материалы',
  SECTOR_INDUSTRIALS: 'промышленность',
  SECTOR_ENERGY: 'энергетика',
  SECTOR_ELECTRONICS: 'электроника',
  SECTOR_CONSUMER_SERVICES: 'потребительские услуги',
  SECTOR_TELECOM: 'телеком',
  SECTOR_UTILITIES: 'коммунальные услуги',
  SECTOR_REAL_ESTATE: 'недвижимость',
  SECTOR_IT: 'информационные технологии',
  SECTOR_TRANSPORT: 'транспорт',
  SECTOR_OTHER: 'прочее',
};

/** Значение, когда брокер не сообщил сектор. */
export const UNKNOWN_SECTOR = 'сектор не определён';

/**
 * Бренд отдаёт сектор строкой в нижнем регистре (`financial`), а справочник
 * актива — enum-ом (`SECTOR_FINANCIAL`). Приводим оба вида к русскому названию.
 */
export const SECTOR_ALIASES: Record<string, string> = {
  financial: 'финансы',
  financials: 'финансы',
  banks: 'финансы',
  energy: 'энергетика',
  oil_and_gas: 'энергетика',
  oil_gas: 'энергетика',
  materials: 'материалы',
  basic_materials: 'материалы',
  metals: 'материалы',
  industrials: 'промышленность',
  industry: 'промышленность',
  healthcare: 'здравоохранение',
  health_care: 'здравоохранение',
  consumer_goods: 'потребительские товары',
  consumer: 'потребительские товары',
  consumer_cyclical: 'потребительские товары',
  consumer_services: 'потребительские услуги',
  retail: 'потребительские товары',
  telecom: 'телеком',
  telecommunications: 'телеком',
  utilities: 'коммунальные услуги',
  real_estate: 'недвижимость',
  it: 'информационные технологии',
  technology: 'информационные технологии',
  information_technology: 'информационные технологии',
  electronics: 'электроника',
  transport: 'транспорт',
  transportation: 'транспорт',
  other: 'прочее',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Название сектора: enum или строка бренда → русское название. */
export const sectorLabel = (raw: string | undefined): string => {
  if (!raw || raw === 'SECTOR_UNSPECIFIED' || raw === 'unspecified') {
    return UNKNOWN_SECTOR;
  }
  const upper = raw.toUpperCase();
  if (SECTOR_LABELS[upper]) {
    return SECTOR_LABELS[upper];
  }
  const normalized = raw
    .toLowerCase()
    .replace(/^sector_/, '')
    .replace(/[\s-]+/g, '_');
  return SECTOR_ALIASES[normalized] ?? raw;
};

/**
 * Сектор из ответа справочника. Форма ответа у брокера менялась, поэтому
 * порядок такой: известные пути → любой `"sector"` в ответе → ничего.
 */
export const sectorOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const brand = asRecord(asset.brand ?? root.brand);

  const candidates = [
    asText(brand.sector),
    asText(asset.sector),
    asText(root.sector),
    asText(asRecord(brand.sector).name),
  ];

  const direct = candidates.find(
    (value) => value !== undefined && value !== 'SECTOR_UNSPECIFIED',
  );
  if (direct) {
    return direct;
  }

  // Последний шанс: сектор лежит глубже, чем мы предполагали.
  try {
    const match = /"sector"\s*:\s*"(SECTOR_[A-Z_]+)"/.exec(JSON.stringify(payload));
    const value = match?.[1];
    return value && value !== 'SECTOR_UNSPECIFIED' ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Идентификатор бренда: сектор можно добрать через `invest_get_brand`. */
export const brandUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const brand = asRecord(asset.brand ?? root.brand);
  return asText(brand.uid) ?? asText(asset.brandUid) ?? asText(root.brandUid);
};

/** Идентификатор актива из ответа справочника или позиции. */
export const assetUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const instrument = asRecord(asset.instrument ?? root.instrument);
  return (
    asText(asset.uid) ??
    asText(root.uid) ??
    // `invest_get_share` с `responseView: FULL` отдаёт uid актива здесь.
    asText(instrument.assetUid) ??
    asText(root.assetUid) ??
    asText(asset.instrumentUid)
  );
};

/** Разбор собранных ответов справочника: сектор и бренд по тикерам. */
export const sectorLookup = (
  entries: { target?: string; text: string }[],
): { byTicker: Map<string, string>; brandByTicker: Map<string, string> } => {
  const byTicker = new Map<string, string>();
  const brandByTicker = new Map<string, string>();

  for (const { target, text } of entries) {
    if (!target) {
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const sector = sectorOf(payload);
    if (sector) {
      byTicker.set(target, sectorLabel(sector));
      continue;
    }
    const brandUid = brandUidOf(payload);
    if (brandUid) {
      brandByTicker.set(target, brandUid);
    }
  }

  return { byTicker, brandByTicker };
};

/** Карта «тикер → сектор» из собранных ответов справочника. */
export const sectorByTicker = (
  entries: { target?: string; text: string }[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const { target, text } of entries) {
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const sector = sectorOf(payload);
    if (target && sector) {
      map.set(target, sectorLabel(sector));
    }
  }
  return map;
};
