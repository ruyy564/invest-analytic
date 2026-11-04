import { readFileSync } from 'node:fs';
import { formatNumber } from '../../agent/report/portfolio-report.js';
import type { SourceCoverageEntry, SourceRegistry } from '../../sources/registry.js';
import type { KeyRateSnapshot } from '../../sources/types.js';
import { DEFAULT_TAX_KEYWORDS } from './tax-watch.js';

export const KEY_RATE_TOOL = 'macro__key_rate';

export interface KeyRateResult {
  snapshot?: KeyRateSnapshot;
  coverage: SourceCoverageEntry;
  asOf: string;
}

/** Текущая ставка ЦБ и история решений из реестра источников. */
export const collectKeyRate = async (
  registry: SourceRegistry,
  now: Date = new Date(),
): Promise<KeyRateResult> => {
  const { snapshot, coverage } = await registry.keyRateSnapshot();
  return { snapshot, coverage, asOf: now.toISOString() };
};

const ORIGIN_TITLES: Record<KeyRateSnapshot['origin'], string> = {
  live: 'получено от ЦБ',
  cache: 'из кэша',
  seed: 'из сид-файла',
  html: 'из HTML-таблицы ЦБ',
};

/** Текст ответа: текущее значение, дата решения и последние изменения. */
export const formatKeyRate = (result: KeyRateResult, historyLimit = 6): string => {
  const { snapshot } = result;
  if (!snapshot) {
    return `Ключевая ставка недоступна: ${result.coverage.reason ?? 'источник не ответил'}.`;
  }

  const lines = [
    `Ключевая ставка ЦБ: ${formatNumber(snapshot.current.rate)} % годовых`,
    `Действует с ${snapshot.current.date} (${ORIGIN_TITLES[snapshot.origin]}, получено ${snapshot.asOf.slice(0, 10)})`,
  ];

  const previous = snapshot.history.slice(1, historyLimit + 1);
  if (previous.length > 0) {
    lines.push('Последние изменения:');
    for (const point of previous) {
      lines.push(`• ${point.date} — ${formatNumber(point.rate)} %`);
    }
  }
  return lines.join('\n');
};

/**
 * Словарь налоговых терминов из файла: по строке `- термин`.
 * Отсутствующий файл — не ошибка: используется встроенный словарь.
 */
export const loadTaxKeywords = (path: string): string[] => {
  try {
    const parsed = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim().toLowerCase())
      .filter((line) => line.length > 0);
    return parsed.length > 0 ? parsed : DEFAULT_TAX_KEYWORDS;
  } catch {
    return DEFAULT_TAX_KEYWORDS;
  }
};
