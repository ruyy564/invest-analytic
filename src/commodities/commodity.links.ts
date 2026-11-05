import type { MetalCode, MetalQuote } from './commodity.types.js';

/** Названия металлов для отчёта. */
export const METAL_LABELS: Record<MetalCode, string> = {
  gold: 'золото',
  silver: 'серебро',
  platinum: 'платина',
  palladium: 'палладий',
};

/**
 * Бумаги, чей результат зависит от драгметалла: тикер → металл.
 * Список намеренно короткий — только те, где связь однозначна.
 */
export const METAL_BY_TICKER: Record<string, MetalCode> = {
  PLZL: 'gold',
  POLY: 'gold',
};

/** Металл, влияющий на бумагу: `undefined` — связь неизвестна. */
export const metalForTicker = (ticker: string): MetalCode | undefined =>
  METAL_BY_TICKER[ticker.toUpperCase()];

/**
 * Строка тула `macro__commodities` → котировка металла.
 * Формат: `золото: 10 187,57 ₽/г (03.11.2026)`.
 */
export const metalQuoteOf = (text: string, metal: MetalCode): MetalQuote | undefined => {
  const label = METAL_LABELS[metal];
  const line = text
    .split('\n')
    .map((row) => row.replace(/^•\s*/, '').trim())
    .find((row) => row.startsWith(`${label}:`));
  if (!line) {
    return undefined;
  }
  const matched = /:\s*([\d\s.,]+?)\s*₽\/г\s*\((\d{2}\.\d{2}\.\d{4})\)/.exec(line);
  if (!matched) {
    return undefined;
  }
  const price = Number(matched[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(price) ? { metal, price, date: matched[2] } : undefined;
};
