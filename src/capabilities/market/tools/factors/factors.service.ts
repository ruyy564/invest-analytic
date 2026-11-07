import type { DynamicStructuredTool } from '@langchain/core/tools';
import { formatNumber } from '../../../reports/index.js';
import { mapCandles } from '../../../instruments/index.js';
import { mapMarketValues } from '../../../../shared/parsing/mappers/market-values.mapper.js';
import type { KeyRateSource } from '../../key-rate/key-rate.types.js';

/** Рыночные факторы числами: причины движения цены без догадок. */
export const FACTORS_TOOL = 'market__factors';

/** Инструмент фактора: биржевой идентификатор и подпись для ответа. */
export interface FactorInstrument {
  id: string;
  title: string;
  unit: string;
}

/**
 * Что читаем: индекс нефти Brent, валютные пары и ключевая ставка.
 * Это публичные рыночные значения — данные пользователя здесь не читаются.
 */
export const FACTOR_INSTRUMENTS: readonly FactorInstrument[] = [
  { id: 'RUCBRNCP_TQBR', title: 'Нефть Brent', unit: 'USD за баррель' },
  { id: 'USD000UTSTOM_CETS', title: 'Доллар/рубль', unit: 'RUB' },
  { id: 'CNYRUB_TOM_CETS', title: 'Юань/рубль', unit: 'RUB' },
];

export interface MarketFactor {
  title: string;
  value: number;
  unit: string;
  /** Значение на начало периода: по нему считается изменение. */
  first?: number;
  changePct?: number;
  /** Пояснение: дата решения по ставке и подобное. */
  note?: string;
}

export interface FactorsResult {
  factors: MarketFactor[];
  days: number;
  asOf: string;
}

export interface FactorsDeps {
  /** MCP-инструмент по имени: свечи и текущие значения. */
  tool: (name: string) => DynamicStructuredTool | undefined;
  timeoutMs: number;
  /** Источник ключевой ставки: ЦБ, кэш или сид-файл. */
  keyRate?: KeyRateSource;
}

/** Значение фактора из дневных свечей; без свечей — текущая цена из стакана. */
const readInstrument = async (
  deps: FactorsDeps,
  instrument: FactorInstrument,
  days: number,
  now: Date,
): Promise<MarketFactor | undefined> => {
  const candles = deps.tool('invest_get_candles');
  if (candles) {
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    try {
      const raw = await candles.invoke({
        instrumentId: instrument.id,
        interval: 'CANDLE_INTERVAL_DAY',
        from: from.toISOString(),
        to: now.toISOString(),
      } as never);
      const { points } = mapCandles(raw);
      if (points.length >= 2) {
        const first = points[0].close;
        const value = points[points.length - 1].close;
        return {
          title: instrument.title,
          value,
          first,
          unit: instrument.unit,
          changePct: first === 0 ? 0 : ((value - first) / first) * 100,
        };
      }
    } catch {
      // Ниже попробуем текущую цену: свечи бывают недоступны (фьючерс, валюта).
    }
  }

  const values = deps.tool('invest_get_market_values');
  if (!values) {
    return undefined;
  }
  try {
    const raw = await values.invoke({ instrumentId: [instrument.id] } as never);
    const found = mapMarketValues(raw);
    const money = found.get(instrument.id) ?? [...found.values()][0];
    return money
      ? { title: instrument.title, value: money.amount, unit: money.currency }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Ключевая ставка: текущее значение и дата решения. */
const readKeyRate = async (deps: FactorsDeps): Promise<MarketFactor | undefined> => {
  if (!deps.keyRate) {
    return undefined;
  }
  try {
    const snapshot = await deps.keyRate.read();
    if (!snapshot) {
      return undefined;
    }
    return {
      title: 'Ключевая ставка ЦБ',
      value: snapshot.current.rate,
      unit: '% годовых',
      note: `действует с ${snapshot.current.date}`,
    };
  } catch {
    return undefined;
  }
};

/** Сбор факторов: каждый читается отдельно, недоступный просто пропускается. */
export const collectFactors = async (
  deps: FactorsDeps,
  days = 30,
  now: Date = new Date(),
): Promise<FactorsResult> => {
  const factors: MarketFactor[] = [];
  for (const instrument of FACTOR_INSTRUMENTS) {
    const factor = await readInstrument(deps, instrument, days, now);
    if (factor) {
      factors.push(factor);
    }
  }
  const keyRate = await readKeyRate(deps);
  if (keyRate) {
    factors.push(keyRate);
  }
  return { factors, days, asOf: now.toISOString() };
};

/** Текст ответа: числа, изменение за период и дата данных. */
export const formatFactors = (result: FactorsResult): string => {
  if (result.factors.length === 0) {
    return 'Рыночные факторы недоступны: котировки нефти, валют и ставки не получены.';
  }
  const lines = [
    `Рыночные факторы за ${result.days} дн. (данные на ${result.asOf.slice(0, 10)}):`,
  ];
  for (const factor of result.factors) {
    let line = `• ${factor.title}: ${formatNumber(factor.value)} ${factor.unit}`;
    if (factor.changePct !== undefined) {
      const sign = factor.changePct > 0 ? '+' : '';
      const from =
        factor.first === undefined
          ? ''
          : ` (${formatNumber(factor.first)} → ${formatNumber(factor.value)})`;
      line += `, за ${result.days} дн.: ${sign}${formatNumber(factor.changePct)} %${from}`;
    }
    if (factor.note) {
      line += ` — ${factor.note}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
};

