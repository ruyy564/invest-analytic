import { DISCLAIMER, DATA_SOURCE } from '../report/portfolio-report.js';
import type { ReportBuildResult } from './engine.js';

/** Итоговый markdown: секции шаблона + подставленная интерпретация + дисклеймер. */
export const composeMarkdown = (
  report: ReportBuildResult,
  interpretation: Record<string, string> = {},
  scopeLabel?: string,
): string => {
  const title = scopeLabel ? `Разбор ${scopeLabel}` : 'Разбор портфеля';
  const lines: string[] = [`${title} (шаблон v${report.templateVersion})`, ''];

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    const text =
      interpretation[section.id] ??
      (section.interpret ? 'Раздел не сформирован: модель не дала ответ.' : section.markdown);
    lines.push(text);
    lines.push('');
  }

  const missing = report.coverage.filter((entry) => entry.status === 'missing');
  if (missing.length > 0) {
    lines.push('## Недоступные источники');
    for (const entry of missing) {
      lines.push(`• ${entry.source}: ${entry.reason ?? 'нет данных'}`);
    }
    lines.push('');
  }

  lines.push(`Источник: ${DATA_SOURCE} и открытые источники, данные на ${report.asOf}`);
  lines.push(DISCLAIMER);
  lines.push(
    'Совет по структуре носит информационный характер и не является индивидуальной инвестиционной рекомендацией.',
  );
  return lines.join('\n');
};
