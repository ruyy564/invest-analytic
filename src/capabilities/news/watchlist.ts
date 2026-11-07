import { readFileSync } from 'node:fs';
import { parseYaml } from '../../shared/parsing/yaml.js';

/**
 * Список бумаг для фонового сбора.
 *
 * Файл `data/watchlist.yaml` — список тикеров (`- LKOH`) или отображение
 * `tickers: [LKOH, SBER]`. Пусто или файла нет — фон собирает только общую
 * повестку и факторы. Список пополняется вручную: это данные, а не код.
 */
export const loadWatchlist = (path: string | undefined, limit = 20): string[] => {
  if (!path) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseYaml(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { tickers?: unknown } | null)?.tickers)
      ? ((parsed as { tickers: unknown[] }).tickers as unknown[])
      : [];

  return [
    ...new Set(
      list
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toUpperCase())
        .filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker)),
    ),
  ].slice(0, limit);
};
