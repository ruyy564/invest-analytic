import { McpInvalidResponseError } from '../mcp/errors.js';

export interface Money {
  readonly amount: number;
  readonly currency: string;
  /** Исходная строка из ответа MCP — для логов и отладки. */
  readonly raw: string;
  /** `true`, если значение пришло в пунктах (`priceCurrency: "pt"`), а не в валюте. */
  readonly isPoints: boolean;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Строгий разбор десятичной строки: `"294.55"` → 294.55. */
export const parseDecimal = (raw: string): number => {
  const value = raw.trim();
  if (!DECIMAL.test(value)) {
    throw new McpInvalidResponseError(`Некорректное число в ответе MCP: "${raw}"`);
  }
  return Number(value);
};

/** MCP отдаёт строчные коды валют (`rub`), пункты — как `pt`. */
export const normalizeCurrency = (code: string, fallback = 'RUB'): string => {
  const value = code.trim();
  if (value.length === 0) {
    return fallback;
  }
  return value.toLowerCase() === 'pt' ? 'pt' : value.toUpperCase();
};

export interface MoneySource {
  value: string;
  currency?: string;
}

/** Разбирает `{ value, currency }` из ответа MCP в доменные деньги. */
export const parseMoney = (
  source: MoneySource | undefined,
  fallbackCurrency: string,
): Money | undefined => {
  if (!source) {
    return undefined;
  }
  const currency = normalizeCurrency(source.currency ?? fallbackCurrency);
  return {
    amount: parseDecimal(source.value),
    currency,
    raw: source.value,
    isPoints: currency === 'pt',
  };
};
