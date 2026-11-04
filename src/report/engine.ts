import { randomUUID } from 'node:crypto';
import { DISCLAIMER, DATA_SOURCE } from '../agent/report/portfolio-report.js';
import type { CollectionResult } from '../collection/executor.js';
import type { CollectionPlan } from '../collection/plan.js';
import type { CoverageEntry } from '../sources/registry.js';
import { renderUnavailable } from './renderers.js';
import type { ReportSection, ReportTemplate } from './template.js';

/** Что поставщик отдаёт движку: готовый текст секции или «нет данных». */
export interface SectionFacts {
  markdown?: string;
  /** Структурированные факты: попадают в JSON-выгрузку. */
  structured?: unknown;
  /** Компактная выжимка для интерпретации моделью. */
  brief?: string;
  /** Причина отсутствия данных. */
  missing?: string;
}

export interface FactContext {
  plan: CollectionPlan;
  collected: CollectionResult;
  template: ReportTemplate;
  now: Date;
}

export interface FactProvider {
  readonly id: string;
  section(ctx: FactContext): SectionFacts | undefined;
}

export interface SectionOutput {
  id: string;
  title: string;
  markdown: string;
  structured?: unknown;
  /** Секцию формулирует модель: код отдаёт только выжимку. */
  interpret: boolean;
}

export interface InterpretationRequest {
  id: string;
  title: string;
  brief: string;
}

export interface ReportBuildResult {
  reportId: string;
  templateVersion: number;
  asOf: string;
  sections: SectionOutput[];
  coverage: CoverageEntry[];
  partial: boolean;
  interpretation: InterpretationRequest[];
}

export interface BuildReportDeps {
  template: ReportTemplate;
  providers: ReadonlyMap<string, FactProvider>;
  plan: CollectionPlan;
  collected: CollectionResult;
  now?: Date;
  reportId?: string;
}

/**
 * Сборка отчёта движком: идём по секциям шаблона, берём факты у поставщиков,
 * секции с признаком интерпретации отдаём модели отдельным списком.
 */
export const buildReport = (deps: BuildReportDeps): ReportBuildResult => {
  const now = deps.now ?? new Date();
  const ctx: FactContext = {
    plan: deps.plan,
    collected: deps.collected,
    template: deps.template,
    now,
  };

  const sections: SectionOutput[] = [];
  const interpretation: InterpretationRequest[] = [];
  const coverage: CoverageEntry[] = [...deps.collected.coverage];
  let partial = deps.collected.partial;

  for (const section of deps.template.sections) {
    const provider = deps.providers.get(section.provider);
    const facts = provider?.section(ctx);

    if (!provider) {
      partial = true;
      coverage.push({
        source: section.provider,
        status: 'missing',
        reason: 'поставщик не зарегистрирован',
      });
      sections.push({
        id: section.id,
        title: section.title,
        markdown: renderUnavailable('поставщик не зарегистрирован'),
        interpret: false,
      });
      continue;
    }

    if (!facts || (!facts.markdown && !facts.brief)) {
      partial = true;
      sections.push({
        id: section.id,
        title: section.title,
        markdown: renderUnavailable(facts?.missing),
        interpret: false,
      });
      continue;
    }

    if (section.interpret) {
      interpretation.push({
        id: section.id,
        title: section.title,
        brief: facts.brief ?? String(facts.markdown ?? ''),
      });
      sections.push({
        id: section.id,
        title: section.title,
        // Текста нет: его даст модель. Заглушка в отчёт не попадает.
        markdown: '',
        structured: facts.structured,
        interpret: true,
      });
      continue;
    }

    sections.push({
      id: section.id,
      title: section.title,
      markdown: facts.markdown ?? '',
      structured: facts.structured,
      interpret: false,
    });
  }

  return {
    reportId: deps.reportId ?? randomUUID(),
    templateVersion: deps.template.version,
    asOf: now.toISOString(),
    sections,
    coverage,
    partial,
    interpretation,
  };
};

/** Итоговый markdown: секции шаблона + подставленная интерпретация + дисклеймер. */
export const composeMarkdown = (
  report: ReportBuildResult,
  interpretation: Record<string, string> = {},
): string => {
  const lines: string[] = [`Разбор портфеля (шаблон v${report.templateVersion})`, ''];

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

/** Проверка, что провайдеры шаблона зарегистрированы: ошибка конфигурации. */
export const missingProviders = (
  template: ReportTemplate,
  providers: ReadonlyMap<string, FactProvider>,
): string[] =>
  [...new Set(template.sections.map((section) => section.provider))].filter(
    (id) => !providers.has(id),
  );

export type { ReportSection };
