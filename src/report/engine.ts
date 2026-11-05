import { randomUUID } from 'node:crypto';
import { DISCLAIMER, DATA_SOURCE } from '../agent/report/portfolio-report.js';
import type { CollectionResult } from '../collection/executor.js';
import type { CollectionPlan } from '../collection/plan.js';
import {
  DEFAULT_KNOWLEDGE_MAX_CHARS,
  type KnowledgeProvider,
} from '../knowledge/index.js';
import type { CoverageEntry } from '../sources/registry.js';
import { renderUnavailable } from './renderers.js';
import { UNKNOWN_SECTOR } from './sector.js';
import type { ReportSection, ReportTemplate, SectionScope } from './template.js';

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
  /** Область разбора: в разборе бумаги таблица показывает только её. */
  scope?: SectionScope;
  scopeTarget?: string;
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
  /** Справочный блок базы знаний: принципы для трактовки, не данные рынка. */
  knowledge?: string;
}

export interface ReportBuildResult {
  reportId: string;
  templateVersion: number;
  /** Область разбора: от неё зависит состав секций. */
  scope: SectionScope;
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
  /** Портфель целиком, счёт или конкретная бумага. */
  scope?: SectionScope;
  /** Тикер бумаги в разборе по бумаге. */
  scopeTarget?: string;
  /** База знаний: из неё собирается справочный контекст интерпретируемых секций. */
  knowledge?: KnowledgeProvider;
  /** Предел объёма справочного блока в символах. */
  knowledgeMaxChars?: number;
}

/** Секторы, под которые подбирается справочный блок: из структуры или из бумаг. */
const sectorsOf = (sections: readonly SectionOutput[]): string[] => {
  const structure = sections.find((section) => section.id === 'structure')?.structured as
    | { bySector?: { name: string }[] }
    | undefined;
  const fromStructure = (structure?.bySector ?? [])
    .map((row) => row.name)
    .filter((name) => name.length > 0 && name !== UNKNOWN_SECTOR);
  if (fromStructure.length > 0) {
    return [...new Set(fromStructure)];
  }

  // Разбор бумаги: структуры портфеля нет, сектор берём из её карточки.
  const securities = sections.find((section) => section.id === 'securities')?.structured as
    | { sector?: string }[]
    | undefined;
  return [
    ...new Set(
      (securities ?? [])
        .map((security) => security.sector)
        .filter((sector): sector is string => !!sector && sector !== UNKNOWN_SECTOR),
    ),
  ];
};

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
    scope: deps.scope ?? 'portfolio',
    scopeTarget: deps.scopeTarget,
  };

  const sections: SectionOutput[] = [];
  const interpretation: InterpretationRequest[] = [];
  const coverage: CoverageEntry[] = [...deps.collected.coverage];
  const scope: SectionScope = deps.scope ?? 'portfolio';
  let partial = deps.collected.partial;

  for (const section of deps.template.sections) {
    // Секция может быть не нужна в этом разборе: «пробелы портфеля» в разборе
    // одной бумаги только шумят.
    if (!section.scopes.includes(scope)) {
      continue;
    }
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

  if (deps.knowledge && !deps.knowledge.isEmpty && interpretation.length > 0) {
    const sectors = sectorsOf(sections);
    const maxChars = deps.knowledgeMaxChars ?? DEFAULT_KNOWLEDGE_MAX_CHARS;
    for (const request of interpretation) {
      // Отбор идёт по разделу и секторам: вся база в промпт не попадает.
      request.knowledge = deps.knowledge.promptBlock({
        section: request.id,
        sectors,
        maxChars,
      });
    }
  }

  return {
    reportId: deps.reportId ?? randomUUID(),
    templateVersion: deps.template.version,
    scope,
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

/** Проверка, что провайдеры шаблона зарегистрированы: ошибка конфигурации. */
export const missingProviders = (
  template: ReportTemplate,
  providers: ReadonlyMap<string, FactProvider>,
): string[] =>
  [...new Set(template.sections.map((section) => section.provider))].filter(
    (id) => !providers.has(id),
  );

export type { ReportSection };
