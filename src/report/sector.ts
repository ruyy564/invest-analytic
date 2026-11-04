/**
 * Сектор бумаги: T-Invest отдаёт его в справочнике актива (`brand.sector`).
 * Здесь — разбор ответа, русские названия и честный фолбэк «не определён».
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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Название сектора: enum → русское название, иначе как пришло. */
export const sectorLabel = (raw: string | undefined): string => {
  if (!raw || raw === 'SECTOR_UNSPECIFIED') {
    return UNKNOWN_SECTOR;
  }
  return SECTOR_LABELS[raw] ?? raw;
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

/** Идентификатор актива из ответа `invest_get_asset` или позиции. */
export const assetUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  return asText(asset.uid) ?? asText(root.uid) ?? asText(asset.instrumentUid);
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
