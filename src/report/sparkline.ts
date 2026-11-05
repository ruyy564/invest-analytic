import type { PriceSeries } from './market-facts.js';

/** Блоки спарклайна: от минимума к максимуму ряда. */
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Спарклайн цены: до `width` равномерно взятых точек, значение → высота блока.
 * Нужен, чтобы форма движения была видна в тексте отчёта, а не только в числах.
 */
export const sparkline = (values: readonly number[], width = 16): string => {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2 || width < 2) {
    return '';
  }
  const size = Math.min(width, clean.length);
  const picked = Array.from({ length: size }, (_, index) => {
    const at = Math.round((index * (clean.length - 1)) / (size - 1));
    return clean[at];
  });
  const min = Math.min(...picked);
  const max = Math.max(...picked);
  if (max === min) {
    return BLOCKS[3].repeat(picked.length);
  }
  return picked
    .map((value) => {
      const level = Math.floor(((value - min) / (max - min)) * (BLOCKS.length - 1));
      return BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, level))];
    })
    .join('');
};

/** Спарклайн по ряду цен бумаги: `undefined`, если истории мало. */
export const sparklineOf = (series: PriceSeries | undefined, width = 16): string =>
  series ? sparkline(series.points.map((point) => point.close), width) : '';

/** Диапазон ряда: минимум и максимум закрытия. */
export const seriesRange = (
  series: PriceSeries | undefined,
): { min: number; max: number } | undefined => {
  const closes = (series?.points ?? []).map((point) => point.close);
  return closes.length > 0 ? { min: Math.min(...closes), max: Math.max(...closes) } : undefined;
};
