import { formatNumber, UNAVAILABLE } from './portfolio-report.js';

/** Доля в процентах с одним знаком: «54,3 %». */
export const formatPercent = (share: number): string =>
  `${formatNumber(share * 100).replace(/\.00$/, ',00')} %`;

/** Таблица «подпись + значения колонок»; заголовки необязательны. */
export const renderTable = (headers: string[], rows: string[][]): string => {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
};

/** Распределение по разрезу: доля и сумма рядом. */
export const renderDistribution = (items: { name: string; share: number; amount?: string }[]): string =>
  items
    .map(
      (item) =>
        `• ${item.name} — ${formatPercent(item.share)}${item.amount ? ` (${item.amount})` : ''}`,
    )
    .join('\n');

/** Простой список строк. */
export const renderList = (items: string[]): string => items.map((item) => `• ${item}`).join('\n');

/** Пары «показатель — значение». */
export const renderKpi = (items: { label: string; value: string }[]): string =>
  items.map((item) => `${item.label}: ${item.value}`).join('\n');

export const renderUnavailable = (reason?: string): string =>
  `Данных нет${reason ? `: ${reason}` : ''}.`;

export { UNAVAILABLE };
