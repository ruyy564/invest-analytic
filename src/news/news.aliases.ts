import { readFileSync } from 'node:fs';

/**
 * Алиасы тикеров: как эмитента называют в новостях («Сбер», «ЛУКОЙЛ», «Полюс»).
 * Формат файла — по строке `ТИКЕР: алиас, алиас`. Файла нет — работаем без алиасов:
 * останутся тикер и название из позиции.
 */
export const loadTickerAliases = (path: string): Record<string, string[]> => {
  try {
    const aliases: Record<string, string[]> = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) {
        continue;
      }
      const separator = trimmed.indexOf(':');
      if (separator <= 0) {
        continue;
      }
      const ticker = trimmed.slice(0, separator).trim().toUpperCase();
      const values = trimmed
        .slice(separator + 1)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 1);
      if (ticker.length > 0 && values.length > 0) {
        aliases[ticker] = [...new Set([...(aliases[ticker] ?? []), ...values])];
      }
    }
    return aliases;
  } catch {
    return {};
  }
};

/**
 * Подстроки для поиска новостей бумаги: тикер, название из позиции и алиасы.
 * Порядок не важен — фильтр проверяет любое совпадение.
 */
export const matchersFor = (
  instrument: { ticker: string; name?: string },
  aliases: Record<string, string[]>,
): string[] => {
  const values = [instrument.ticker, instrument.name, ...(aliases[instrument.ticker] ?? [])];
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
    .map((value) => value.trim())
    .filter((value) => value.length > 1);
};
