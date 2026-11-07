import { resultsInGroup } from '../../collection/executor.js';
import { formatNumber } from '../../portfolio-report.js';
import {
  EXPOSURE_LABELS,
  exposureOf,
  sectorProfileOf,
  sensitivityWord,
  type CompanyProfiles,
} from '../../company-profiles.js';
import type { FactContext, FactProvider, SectionFacts } from '../../engine.js';
import {
  calendarItems,
  driverLines,
  fundamentalsLine,
  parseCbMeetingLines,
  parseFactors,
  parseFundamentals,
  parseReportCalendar,
  scoreItems,
} from '../../analytics.js';
import { formatChangePct, trendWord } from '../../market-facts.js';
import { marketHeadlines } from '../market-news.provider.js';
import { RECOMMENDATIONS } from '../market.js';
import { dividendLine, insiderLine, securitiesOf } from './shared.js';

/**
 * Вывод по бумаге: сводит в один брифинг всё, что собрано о бумаге и её секторе —
 * цену и динамику, мнение аналитиков, дивиденды, инсайдеров, профиль, новости бумаги,
 * фон рынка и ставку. Модель формулирует разбор «за и против», числа остаются за кодом.
 */
export const createConclusionProvider = (profiles: CompanyProfiles): FactProvider => ({
  id: 'securities.conclusion',
  section(ctx: FactContext): SectionFacts | undefined {
    if (ctx.scope !== 'instrument') {
      return undefined;
    }
    const [security] = securitiesOf(ctx);
    if (!security) {
      return { missing: 'нет данных по бумаге' };
    }

    const lines: string[] = [`${security.ticker} (${security.sector})`];
    if (security.price !== undefined) {
      lines.push(`цена ${formatNumber(security.price)} ${security.currency} за штуку`);
    }
    if (security.periods.length > 0) {
      const longest = security.periods.at(-1);
      lines.push(
        `динамика: ${security.periods
          .map((period) => `${period.label} ${formatChangePct(period.changePct)}`)
          .join(', ')}${longest ? ` — ${trendWord(longest.change)} за ${longest.label}` : ''}`,
      );
    }
    if (security.forecast) {
      const parts = [
        RECOMMENDATIONS[security.forecast.recommendation ?? ''] ??
          security.forecast.recommendation ??
          'без рекомендации',
        security.forecast.consensus !== undefined
          ? `цель ${formatNumber(security.forecast.consensus)}`
          : undefined,
        security.forecast.upside !== undefined
          ? `потенциал ${formatChangePct(security.forecast.upside)}`
          : undefined,
      ].filter((part): part is string => part !== undefined);
      lines.push(`аналитики: ${parts.join(', ')}`);
    }
    if (security.dividend) {
      lines.push(dividendLine(security.dividend).replace('• ', ''));
    }
    if (security.insider) {
      lines.push(insiderLine(security.insider).replace('• ', ''));
    }

    const exposure = exposureOf(profiles, security.ticker, security.sector);
    const sectorProfile = sectorProfileOf(profiles, security.sector);
    if (exposure) {
      lines.push(
        `профиль: ${EXPOSURE_LABELS[exposure.exposure]}` +
          (exposure.currencyShare !== undefined
            ? `, валютная выручка около ${formatNumber(exposure.currencyShare * 100)} %`
            : ''),
      );
    }
    if (sectorProfile) {
      lines.push(
        `чувствительность: ${sensitivityWord(sectorProfile.currency, 'курс')}, ` +
          `${sensitivityWord(sectorProfile.rate, 'ставка')}`,
      );
      if (sectorProfile.drivers.length > 0) {
        lines.push(`драйверы сектора: ${sectorProfile.drivers.join(', ')}`);
      }
    }

    if (security.news.length > 0) {
      lines.push(`новости бумаги: ${security.news.join('; ')}`);
    }
    const headlines = marketHeadlines(ctx, 3);
    if (headlines.length > 0) {
      lines.push(`фон рынка: ${headlines.join('; ')}`);
    }
    const rate = resultsInGroup(ctx.plan, ctx.collected, 'macro')[0]?.text
      ?.split('\n')[0]
      ?.trim();
    if (rate) {
      lines.push(`ставка: ${rate}`);
    }

    // Аналитические факты те же, что в блоках «что влияет», «хорошо/плохо», «чего ждём»:
    // модель формулирует по ним, а не придумывает числа.
    const fundamentalsText = resultsInGroup(ctx.plan, ctx.collected, 'fundamentals').find(
      (item) => item.entry.target === security.ticker,
    )?.text;
    const fundamentals = fundamentalsText ? parseFundamentals(fundamentalsText) : undefined;
    const fundamentalLine = fundamentalsLine(fundamentals);
    if (fundamentalLine) {
      lines.push(fundamentalLine);
    }

    const factors = parseFactors(
      resultsInGroup(ctx.plan, ctx.collected, 'market_factors')[0]?.text ?? '',
    );
    const drivers = driverLines({
      sectorDrivers: sectorProfile?.drivers ?? [],
      currency: sectorProfile?.currency ?? 'neutral',
      rate: sectorProfile?.rate ?? 'neutral',
      factors,
      limit: 3,
    });
    if (drivers.length > 0) {
      lines.push(`влияет: ${drivers.join(' ')}`);
    }

    const score = scoreItems({
      upsidePct: security.forecast?.upside,
      price: security.price,
      target: security.forecast?.consensus,
      fundamentals,
    });
    lines.push(`оценка по фактам: ${score.map((item) => `${item.label} — ${item.verdict}`).join('; ')}`);

    const reportText = resultsInGroup(ctx.plan, ctx.collected, 'reports_calendar').find(
      (item) => item.entry.target === security.ticker,
    )?.text;
    const calendar = calendarItems({
      now: ctx.now,
      report: reportText ? parseReportCalendar(reportText, ctx.now) : undefined,
      dividendNext: security.dividend?.next,
      dividendLast: security.dividend?.last,
      cbMeetings: parseCbMeetingLines(
        resultsInGroup(ctx.plan, ctx.collected, 'cb_meetings')[0]?.text ?? '',
      ),
      bondMaturity: security.bond?.maturityDate,
    });
    lines.push(
      calendar.length > 0
        ? `календарь: ${calendar
            .map((item) => `${item.date ?? 'без даты'} ${item.title}`)
            .join('; ')}`
        : 'календарь: дат в данных нет',
    );

    return {
      markdown: lines.join('\n'),
      brief: lines.join(' | ').slice(0, 3_000),
    };
  },
});
