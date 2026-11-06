import type { Money } from '../../shared/parsing/mappers/money.js';


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

export const formatDataAsOf = (value: string, now: Date = new Date()): string => {
  const parsed = Date.parse(value);
  const date = Number.isNaN(parsed) ? now : new Date(parsed);
  return date.toISOString();
};
