import { resultsInGroup } from '../../collection/executor.js';
import {
  calendarItems,
  driverLines,
  parseCbMeetingLines,
  parseFactors,
  parseFundamentals,
  parseReportCalendar,
  SCORE_NOTE,
  scoreItems,
} from '../../analytics.js';
import { sectorProfileOf, type CompanyProfiles } from '../../company-profiles.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import { renderList } from '../../renderers.js';
import { noHoldingsReason, securitiesOf } from './shared.js';

/**
 * Аналитические секции записки по бумаге: «что влияет», «хорошо / нейтрально /
 * плохо», «чего ждём». Числа и вердикты считает код, модель их только трактует —
 * поэтому в отчёте не появляются выдуманные ставки, даты и мультипликаторы.
 */

/** Текст группы по тикеру: у фундаментала и календаря записи привязаны к бумаге. */
const groupTextOf = (ctx: FactContext, group: string): string | undefined =>
  resultsInGroup(ctx.plan, ctx.collected, group)[0]?.text;

const sharedTextOf = (ctx: FactContext, group: string, ticker: string): string | undefined =>
  resultsInGroup(ctx.plan, ctx.collected, group).find((item) => item.entry.target === ticker)?.text;

const dayOf = (now: Date): string => now.toISOString().slice(0, 10);

/** Только разбор бумаги: в разборе портфеля эти блоки — шум. */
const instrumentScope = (ctx: FactContext): boolean => ctx.scope === 'instrument';

export const createAnalyticsProviders = (profiles: CompanyProfiles): FactProvider[] => [
  {
    id: 'analytics.drivers',
    section(ctx: FactContext): SectionFacts | undefined {
      if (!instrumentScope(ctx)) {
        return undefined;
      }
      const [security] = securitiesOf(ctx);
      if (!security) {
        return { missing: noHoldingsReason(ctx) };
      }
      const sectorProfile = sectorProfileOf(profiles, security.sector);
      // Рыночные значения приходят числами из `market__factors`: без них блок — общие слова.
      const factors = parseFactors(groupTextOf(ctx, 'market_factors') ?? '');
      const lines = driverLines({
        sectorDrivers: sectorProfile?.drivers ?? [],
        currency: sectorProfile?.currency ?? 'neutral',
        rate: sectorProfile?.rate ?? 'neutral',
        factors,
        limit: 4,
      });
      if (lines.length === 0) {
        return { missing: 'драйверов сектора и рыночных значений в данных нет' };
      }
      return {
        markdown: [
          `Факторы для ${security.ticker} (${security.sector}), данные на ${dayOf(ctx.now)}:`,
          renderList(lines),
        ].join('\n'),
        structured: { drivers: sectorProfile?.drivers ?? [], factors },
        brief: lines.join(' | ').slice(0, 1_500),
      };
    },
  },
  {
    id: 'analytics.scorecard',
    section(ctx: FactContext): SectionFacts | undefined {
      if (!instrumentScope(ctx)) {
        return undefined;
      }
      const [security] = securitiesOf(ctx);
      if (!security) {
        return { missing: noHoldingsReason(ctx) };
      }
      const fundamentalsText = sharedTextOf(ctx, 'fundamentals', security.ticker);
      const fundamentals = fundamentalsText ? parseFundamentals(fundamentalsText) : undefined;
      const items = scoreItems({
        upsidePct: security.forecast?.upside,
        price: security.price,
        target: security.forecast?.consensus,
        fundamentals,
      });
      return {
        markdown: [
          renderList(items.map((item) => `${item.label}: ${item.verdict} — ${item.detail}`)),
          SCORE_NOTE,
        ].join('\n'),
        structured: { items, fundamentals },
        brief: items.map((item) => `${item.label} — ${item.verdict} (${item.detail})`).join('; '),
      };
    },
  },
  {
    id: 'analytics.calendar',
    section(ctx: FactContext): SectionFacts | undefined {
      if (!instrumentScope(ctx)) {
        return undefined;
      }
      const [security] = securitiesOf(ctx);
      if (!security) {
        return { missing: noHoldingsReason(ctx) };
      }
      const reportText = sharedTextOf(ctx, 'reports_calendar', security.ticker);
      const meetings = parseCbMeetingLines(groupTextOf(ctx, 'cb_meetings') ?? '');
      const items = calendarItems({
        now: ctx.now,
        report: reportText ? parseReportCalendar(reportText, ctx.now) : undefined,
        dividendNext: security.dividend?.next,
        dividendLast: security.dividend?.last,
        cbMeetings: meetings,
        bondMaturity: security.bond?.maturityDate,
      });
      if (items.length === 0) {
        // Спецификация требует прямоты: пустой календарь — «дат в данных нет».
        return {
          markdown: 'Дат в данных нет: брокер не публикует ни отчётности, ни отсечек, ни заседаний ЦБ.',
        };
      }
      const lines = items.map(
        (item) => `${item.date ?? 'без даты'} — ${item.title}${item.note ? `: ${item.note}` : ''}`,
      );
      return {
        markdown: renderList(lines),
        structured: { items },
        brief: lines.join(' | ').slice(0, 1_500),
      };
    },
  },
];
