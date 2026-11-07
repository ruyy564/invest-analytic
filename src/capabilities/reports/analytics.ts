import type { Sensitivity } from './company-profiles.js';
import { formatNumber } from './format.js';
import { formatChangePct } from './market-facts.js';

/**
 * Аналитические блоки записки по бумаге: «что влияет», «хорошо / нейтрально /
 * плохо», «чего ждём».
 *
 * Всё считается кодом из собранных данных: числа, даты и вердикты берутся из
 * ответов брокера и рыночных значений, модель только формулирует текст. Поэтому
 * здесь нет ни одного обращения к сети и ни одной оценки «на глаз».
 */

/** Ориентиры для вердиктов: меняются вместе с методикой, а не в промпте. */
export const SCORE_THRESHOLDS = {
  /** Потенциал до цели аналитиков, %: выше — хорошо, ниже — плохо. */
  upsideGood: 15,
  upsideBad: -5,
  /** Дивидендная доходность выше средней за 5 лет на эту величину (п.п.) — хорошо. */
  dividendAboveAverage: 1,
  /** Рентабельность капитала, %: выше — хорошо, ниже — плохо. */
  roeGood: 15,
  roeBad: 5,
  /** Долг / EBITDA: ниже — хорошо, выше — плохо. */
  debtGood: 1.5,
  debtBad: 3,
} as const;

/** Пояснение к вердиктам: ориентиры кода, а не рекомендация. */
export const SCORE_NOTE =
  'Ориентиры кода, а не рекомендация: цель аналитиков +15 / −5 п.п., долг 1,5× / 3× EBITDA, ROE 15 % / 5 %.';

export type Verdict = 'хорошо' | 'нейтрально' | 'плохо' | 'нет данных';

export interface ScoreItem {
  label: string;
  verdict: Verdict;
  /** Почему такой вердикт: числа из данных. */
  detail: string;
}

export interface CalendarItem {
  /** Дата события `YYYY-MM-DD`; без даты — событие без срока. */
  date?: string;
  title: string;
  /** Что это значит для бумаги: только факты и (оценка), если это трактовка. */
  note?: string;
}

export interface FactorLine {
  title: string;
  value: number;
  unit: string;
  changePct?: number;
  note?: string;
}

/** Число из русского формата: «1 234,50» → 1234.5. */
export const parseRuNumber = (value: string): number | undefined => {
  const normalized = value.replace(/[\s\u00a0]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const NUMBER = '(-?[\\d\\s\\u00a0]*\\d(?:[.,]\\d+)?)';

/** Строки «Рыночные факторы» обратно в числа: формат свой, поэтому разбор строгий. */
export const parseFactors = (text: string): FactorLine[] => {
  const factors: FactorLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^•\s*/, '').trim();
    const colon = line.indexOf(': ');
    if (colon <= 0) {
      continue;
    }
    const title = line.slice(0, colon).trim();
    const rest = line.slice(colon + 2).trim();
    const valueMatch = new RegExp(`^${NUMBER}`).exec(rest);
    const value = valueMatch ? parseRuNumber(valueMatch[1]) : undefined;
    if (!valueMatch || value === undefined) {
      continue;
    }
    const changeMatch = /за\s+\d+\s+дн\.:\s*([+-]?[\d\s\u00a0]*\d(?:[.,]\d+)?)\s*%/.exec(rest);
    const changePct = changeMatch ? parseRuNumber(changeMatch[1]) : undefined;
    const noteMatch = /\s—\s(.+)$/.exec(rest);
    // Единица измерения — только до изменения и до пояснения: иначе в неё
    // попадут «за 30 дн.» и дата решения по ставке.
    const unit = rest
      .slice(valueMatch[0].length)
      .split(', за ')[0]
      .split(' — ')[0]
      .trim();
    factors.push({
      title,
      value,
      unit,
      ...(changePct !== undefined ? { changePct } : {}),
      ...(noteMatch ? { note: noteMatch[1].trim() } : {}),
    });
  }
  return factors;
};

const asJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Показатель, которого нет: брокер отдаёт нули вместо пустых значений. */
const positive = (value: unknown): number | undefined => {
  const parsed = asNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

/** Отчётный период из ответа брокера: «3 кв. 2026». */
const periodLabel = (year: unknown, num: unknown): string | undefined => {
  const quarter = asNumber(num);
  const periodYear = asNumber(year);
  if (quarter === undefined || periodYear === undefined || quarter < 1 || quarter > 4) {
    return undefined;
  }
  return `${quarter} кв. ${periodYear}`;
};

export interface ReportEvent {
  date: string;
  label?: string;
}

export interface ReportCalendar {
  /** Последняя известная публикация отчётности. */
  last?: ReportEvent;
  /** Следующая ожидаемая дата: посчитана по периодичности, поэтому «оценка». */
  next?: ReportEvent & { estimated: true };
  /** Периодичность публикаций в днях, если она определилась по истории. */
  cadenceDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Календарь отчётности: последняя публикация и ожидаемая следующая дата. */
export const parseReportCalendar = (text: string, now: Date = new Date()): ReportCalendar => {
  const root = asRecord(asJson(text));
  const events = Array.isArray(root?.events) ? root.events : [];
  const dated = events
    .map((item): ReportEvent | undefined => {
      const record = asRecord(item);
      const date =
        typeof record?.reportDate === 'string' ? record.reportDate.slice(0, 10) : undefined;
      const label = periodLabel(record?.periodYear, record?.periodNum);
      return date && !Number.isNaN(Date.parse(date)) ? { date, label } : undefined;
    })
    .filter((event): event is ReportEvent => event !== undefined)
    .sort((left, right) => left.date.localeCompare(right.date));

  const last = dated.at(-1);
  if (!last) {
    return {};
  }
  // Периодичность — по промежуткам между последними публикациями: по одному
  // событию оценку не строим, это была бы догадка.
  const tailDates = dated.slice(-5).map((event) => Date.parse(event.date));
  const gaps = tailDates.slice(1).flatMap((value, index) => {
    const previous = tailDates[index];
    const gap = previous === undefined ? 0 : (value - previous) / DAY_MS;
    return gap > 0 ? [gap] : [];
  });
  if (gaps.length === 0) {
    return { last };
  }
  const cadenceDays = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
  const nextDate = new Date(Date.parse(last.date) + cadenceDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return {
    last,
    cadenceDays,
    ...(nextDate >= now.toISOString().slice(0, 10)
      ? { next: { date: nextDate, estimated: true as const } }
      : {}),
  };
};

export interface Fundamentals {
  marketCap?: number;
  pe?: number;
  pb?: number;
  roe?: number;
  roa?: number;
  netMargin?: number;
  debtToEquity?: number;
  netDebtToEbitda?: number;
  dividendYieldPct?: number;
  averageDividendYieldPct?: number;
  eps?: number;
  revenue?: number;
  revenueGrowthPct?: number;
  highPrice52w?: number;
  lowPrice52w?: number;
  beta?: number;
}

/** Фундаментал бумаги: нулевые показатели — «нет данных», а не нули в отчёте. */
export const parseFundamentals = (text: string): Fundamentals | undefined => {
  const root = asRecord(asJson(text));
  const list = Array.isArray(root?.fundamentals) ? root.fundamentals : [];
  const record = asRecord(list[0]);
  if (!record) {
    return undefined;
  }
  const fundamentals: Fundamentals = {
    marketCap: positive(record.marketCapitalization),
    pe: positive(record.peRatioTtm),
    pb: positive(record.priceToBookTtm),
    roe: positive(record.roe),
    roa: positive(record.roa),
    netMargin: positive(record.netMarginMrq),
    debtToEquity: positive(record.totalDebtToEquityMrq),
    netDebtToEbitda: positive(record.netDebtToEbitda) ?? positive(record.totalDebtToEbitdaMrq),
    dividendYieldPct: positive(record.dividendYieldDailyTtm),
    averageDividendYieldPct: positive(record.fiveYearsAverageDividendYield),
    eps: positive(record.epsTtm),
    revenue: positive(record.revenueTtm),
    revenueGrowthPct: asNumber(record.oneYearAnnualRevenueGrowthRate),
    highPrice52w: positive(record.highPriceLast52Weeks),
    lowPrice52w: positive(record.lowPriceLast52Weeks),
    beta: positive(record.beta),
  };
  return Object.values(fundamentals).some((value) => value !== undefined) ? fundamentals : undefined;
};


export interface ScoreInput {
  /** Потенциал до цели аналитиков, %. */
  upsidePct?: number;
  price?: number;
  target?: number;
  fundamentals?: Fundamentals;
}

const verdictOf = (
  value: number | undefined,
  good: (value: number) => boolean,
  bad: (value: number) => boolean,
): Verdict => {
  if (value === undefined) {
    return 'нет данных';
  }
  if (good(value)) {
    return 'хорошо';
  }
  return bad(value) ? 'плохо' : 'нейтрально';
};

/** «Хорошо / нейтрально / плохо» по фактам: каждая строка — с числами. */
export const scoreItems = (input: ScoreInput): ScoreItem[] => {
  const { upsidePct, price, target, fundamentals } = input;
  const items: ScoreItem[] = [];

  items.push({
    label: 'Мнение аналитиков',
    verdict: verdictOf(
      upsidePct,
      (value) => value >= SCORE_THRESHOLDS.upsideGood,
      (value) => value <= SCORE_THRESHOLDS.upsideBad,
    ),
    detail:
      upsidePct === undefined
        ? 'цели и рекомендаций в данных нет'
        : `потенциал ${formatChangePct(upsidePct)}` +
          (price !== undefined && target !== undefined
            ? ` (цена ${formatNumber(price)} → цель ${formatNumber(target)})`
            : ''),
  });

  const dividendYield = fundamentals?.dividendYieldPct;
  const averageYield = fundamentals?.averageDividendYieldPct;
  const yieldGap =
    dividendYield !== undefined && averageYield !== undefined
      ? dividendYield - averageYield
      : undefined;
  items.push({
    label: 'Дивиденды',
    verdict: verdictOf(
      yieldGap,
      (value) => value >= SCORE_THRESHOLDS.dividendAboveAverage,
      (value) => value < 0,
    ),
    detail:
      dividendYield === undefined
        ? 'дивидендной доходности в данных нет'
        : averageYield === undefined
          ? `доходность ${formatNumber(dividendYield)} %; средней за 5 лет в данных нет`
          : `доходность ${formatNumber(dividendYield)} % против средней за 5 лет ` +
            `${formatNumber(averageYield)} %`,
  });

  items.push({
    label: 'Рентабельность капитала',
    verdict: verdictOf(
      fundamentals?.roe,
      (value) => value >= SCORE_THRESHOLDS.roeGood,
      (value) => value < SCORE_THRESHOLDS.roeBad,
    ),
    detail:
      fundamentals?.roe === undefined
        ? 'ROE в данных нет'
        : `ROE ${formatNumber(fundamentals.roe)} %` +
          (fundamentals.netMargin !== undefined
            ? `, чистая маржа ${formatNumber(fundamentals.netMargin)} %`
            : ''),
  });

  const debt = fundamentals?.netDebtToEbitda;
  items.push({
    label: 'Долговая нагрузка',
    verdict: verdictOf(
      debt,
      (value) => value < SCORE_THRESHOLDS.debtGood,
      (value) => value > SCORE_THRESHOLDS.debtBad,
    ),
    detail:
      debt === undefined
        ? 'долговую нагрузку брокер не раскрыл'
        : `долг / EBITDA ${formatNumber(debt)}×` +
          (fundamentals?.debtToEquity !== undefined
            ? `, долг / капитал ${formatNumber(fundamentals.debtToEquity)}×`
            : ''),
  });

  return items;
};

export interface CalendarInput {
  now?: Date;
  report?: ReportCalendar;
  /** Ближайшая дивидендная отсечка из ответа брокера. */
  dividendNext?: {
    recordDate?: string;
    lastBuyDate?: string;
    paymentDate?: string;
    amount?: number;
  };
  /** Последняя прошедшая выплата: видно, когда ждать следующую. */
  dividendLast?: { recordDate?: string; paymentDate?: string };
  /** Заседания ЦБ из файла-данных. */
  cbMeetings?: { date: string; type?: string }[];
  /** Погашение облигации. */
  bondMaturity?: string;
}

/** «Чего ждём»: даты событий. Пустой список — дат в данных нет, а не «скоро». */
export const calendarItems = (input: CalendarInput): CalendarItem[] => {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const items: CalendarItem[] = [];

  const nextReport = input.report?.next;
  if (nextReport) {
    items.push({
      date: nextReport.date,
      title: 'Отчётность',
      note: 'дата ожидаемая: посчитана по периодичности публикаций (оценка)',
    });
  } else if (input.report?.last) {
    items.push({
      date: input.report.last.date,
      title: 'Отчётность',
      note: `последняя публикация${input.report.last.label ? ` за ${input.report.last.label}` : ''}`,
    });
  }

  const dividend = input.dividendNext;
  const cut = dividend?.lastBuyDate ?? dividend?.recordDate;
  if (cut && cut >= today) {
    items.push({
      date: cut,
      title: 'Дивидендная отсечка',
      note:
        'последний день покупки с дивидендом: позже выплату не получить' +
        (dividend?.amount !== undefined ? `, выплата ${formatNumber(dividend.amount)}` : ''),
    });
  } else if (input.dividendLast?.recordDate) {
    items.push({
      date: input.dividendLast.recordDate,
      title: 'Дивиденды',
      note: 'будущих отсечек брокер не публикует; это последняя прошедшая',
    });
  }

  const meeting = [...(input.cbMeetings ?? [])]
    .filter((item) => item.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  if (meeting) {
    items.push({
      date: meeting.date,
      title: 'Заседание ЦБ',
      note: `решение по ключевой ставке${meeting.type ? ` (${meeting.type} заседание)` : ''}`,
    });
  }

  if (input.bondMaturity && input.bondMaturity >= today) {
    items.push({ date: input.bondMaturity, title: 'Погашение облигации' });
  }

  return items;
};


export interface CbMeetingLine {
  date: string;
  type?: string;
}

/**
 * Заседания ЦБ из текста инструмента `macro__cb_meetings`:
 * «Заседания ЦБ …: 2026-12-18 (опорное), 2027-02-12 (предварительное) (план на …)».
 */
export const parseCbMeetingLines = (text: string): CbMeetingLine[] => {
  const colon = text.indexOf(':');
  if (colon < 0) {
    return [];
  }
  const list = text
    .slice(colon + 1)
    .replace(/\s*\(план на [^)]*\).*$/s, '')
    .trim();
  const meetings: CbMeetingLine[] = [];
  for (const part of list.split(',')) {
    const match = /^\s*(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]+)\))?\s*$/.exec(part);
    if (match) {
      meetings.push({ date: match[1], ...(match[2] ? { type: match[2] } : {}) });
    }
  }
  return meetings;
};

export interface DriverInput {
  /** Драйверы сектора из профилей: «нефть», «курс рубля». */
  sectorDrivers: string[];
  /** Реакция сектора на курс и ставку. */
  currency: Sensitivity;
  rate: Sensitivity;
  factors: FactorLine[];
  /** Сколько строк показывать: блок должен оставаться коротким. */
  limit?: number;
}

const OIL_PATTERN = /нефт|brent|газ|сырь|металл|золот/i;
const CURRENCY_PATTERN = /доллар|usd|юань|cny|валют|курс/i;

const directionWord = (value: number, sensitivity: Sensitivity): string => {
  if (sensitivity === 'neutral' || value === 0) {
    return 'нейтрально';
  }
  const favorable = sensitivity === 'positive' ? value > 0 : value < 0;
  return favorable ? 'плюс' : 'минус';
};

/**
 * «Что влияет на бумагу»: драйверы сектора и рыночные значения числами.
 * Направление влияния берётся из профиля сектора, поэтому помечено как оценка.
 */
export const driverLines = (input: DriverInput): string[] => {
  const lines: string[] = [];
  if (input.sectorDrivers.length > 0) {
    lines.push(`Драйверы сектора: ${input.sectorDrivers.join(', ')}.`);
  }

  const relevant = (factor: FactorLine): boolean => {
    if (OIL_PATTERN.test(factor.title)) {
      return input.sectorDrivers.some((driver) => OIL_PATTERN.test(driver));
    }
    if (CURRENCY_PATTERN.test(factor.title)) {
      return input.currency !== 'neutral';
    }
    return /ставка/i.test(factor.title);
  };

  for (const factor of input.factors.filter(relevant).slice(0, input.limit ?? 4)) {
    const value = `${formatNumber(factor.value)} ${factor.unit}`;
    const change =
      factor.changePct === undefined ? '' : `, за период ${formatChangePct(factor.changePct)}`;
    if (/ставка/i.test(factor.title)) {
      // `positive` — рост ставки в плюс (банки), `negative` — в минус (застройщики, ритейл).
      const sensitivityWord =
        input.rate === 'positive'
          ? 'рост ставки — в плюс'
          : input.rate === 'negative'
            ? 'рост ставки — в минус'
            : 'влияние ставки слабое';
      lines.push(
        `${factor.title}: ${value}${factor.note ? ` (${factor.note})` : ''} — ` +
          `${sensitivityWord} (оценка).`,
      );
      continue;
    }
    if (factor.changePct === undefined) {
      lines.push(`${factor.title}: ${value}${change}.`);
      continue;
    }
    const sensitivity = OIL_PATTERN.test(factor.title) ? ('positive' as Sensitivity) : input.currency;
    lines.push(
      `${factor.title}: ${value}${change} — для бумаги это ` +
        `${directionWord(factor.changePct, sensitivity)} (оценка).`,
    );
  }

  return lines;
};

/** Числа фундаментала одной строкой: для брифинга модели. */
export const fundamentalsLine = (fundamentals: Fundamentals | undefined): string | undefined => {
  if (!fundamentals) {
    return undefined;
  }
  const parts: string[] = [];
  if (fundamentals.pe !== undefined) {
    parts.push(`P/E ${formatNumber(fundamentals.pe)}`);
  }
  if (fundamentals.pb !== undefined) {
    parts.push(`P/B ${formatNumber(fundamentals.pb)}`);
  }
  if (fundamentals.roe !== undefined) {
    parts.push(`ROE ${formatNumber(fundamentals.roe)} %`);
  }
  if (fundamentals.netDebtToEbitda !== undefined) {
    parts.push(`долг/EBITDA ${formatNumber(fundamentals.netDebtToEbitda)}×`);
  }
  if (fundamentals.dividendYieldPct !== undefined) {
    parts.push(`дивидендная доходность ${formatNumber(fundamentals.dividendYieldPct)} %`);
  }
  return parts.length > 0 ? `фундаментал: ${parts.join(', ')}` : undefined;
};
