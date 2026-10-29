import type { Money } from '../../tools/mappers/money.js';
import type { Portfolio, PortfolioPosition } from '../../tools/mappers/portfolio.mapper.js';

export const UNAVAILABLE = 'недоступно';
export const DISCLAIMER =
  'Это информационная сводка по данным брокера, а не инвестиционная рекомендация.';
export const DATA_SOURCE = 'Tinkoff Invest';

/** Число с двумя знаками и пробелами между тысячами, отрицательные — со знаком. */
export const formatNumber = (value: number): string => {
  const fixed = Math.abs(value).toFixed(2);
  const [integer, fraction] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}${grouped},${fraction}`;
};

/** Деньги в валюте портфеля; пункты (`pt`) не подписываются как валюта. */
export const formatMoney = (money: Money | undefined): string => {
  if (!money) {
    return UNAVAILABLE;
  }
  return money.isPoints
    ? `${formatNumber(money.amount)} пт`
    : `${formatNumber(money.amount)} ${money.currency}`;
};

export const formatPosition = (position: PortfolioPosition): string => {
  const { instrument, quantity, currentPrice, positionValue } = position;
  return (
    `${instrument.ticker} (${instrument.name}): ` +
    `${formatNumber(quantity.amount)} шт. × ${formatMoney(currentPrice)} = ${formatMoney(positionValue)}`
  );
};

export const formatDataAsOf = (value: string, now: Date = new Date()): string => {
  const parsed = Date.parse(value);
  const date = Number.isNaN(parsed) ? now : new Date(parsed);
  return date.toISOString();
};

export interface ReportOptions {
  dataAsOf: string;
  now?: Date;
}

/**
 * Детерминированная сводка по портфелю: числа считает код, а не модель.
 * Пустой портфель и недоступные значения помечаются явно.
 */
export const formatPortfolioReport = (
  portfolio: Portfolio,
  options: ReportOptions,
): string => {
  const lines: string[] = [];

  if (portfolio.positions.length === 0) {
    lines.push('Портфель пуст: позиций нет.');
  } else {
    lines.push('Портфель:');
    for (const position of portfolio.positions) {
      lines.push(`• ${formatPosition(position)}`);
    }
  }

  lines.push(`Итого: ${formatMoney(portfolio.totalValue)}`);

  if (portfolio.expectedYield) {
    lines.push(`Доходность: ${formatMoney(portfolio.expectedYield)}`);
  }

  lines.push(`Источник: ${DATA_SOURCE}, данные на ${formatDataAsOf(options.dataAsOf, options.now)}`);
  lines.push(DISCLAIMER);

  return lines.join('\n');
};
