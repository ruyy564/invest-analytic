import type { PortfolioPosition } from '../../shared/parsing/mappers/portfolio.mapper.js';
import { formatMoney, formatNumber } from './format.js';


export const formatPosition = (position: PortfolioPosition): string => {
  const { instrument, quantity, currentPrice, positionValue } = position;
  return (
    `${instrument.ticker} (${instrument.name}): ` +
    `${formatNumber(quantity.amount)} шт. × ${formatMoney(currentPrice)} = ${formatMoney(positionValue)}`
  );
};
/** Позиция без цены и стоимости — так приходит `invest_get_positions`. */
export const isQuantityOnly = (position: PortfolioPosition): boolean =>
  position.currentPrice === undefined && position.positionValue === undefined;

/**
 * Строка позиции в сводке: количество, а при известной цене — ещё цена и стоимость.
 * «77,00 шт.» без цены — это честное «брокер не дал цену», а не ноль.
 */
export const formatPortfolioPosition = (position: PortfolioPosition): string => {
  const ticker = position.instrument.ticker;
  const quantity = `${formatNumber(position.quantity.amount)} шт.`;
  if (position.currentPrice) {
    return `${ticker}: ${quantity} × ${formatMoney(position.currentPrice)} = ${formatMoney(position.positionValue)}`;
  }
  return `${ticker}: ${quantity}`;
};

