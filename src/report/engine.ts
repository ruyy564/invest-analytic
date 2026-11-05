import { randomUUID } from 'node:crypto';
import { DEFAULT_KNOWLEDGE_MAX_CHARS } from '../knowledge/index.js';
import type { CoverageEntry } from '../news/news.registry.js';
import { renderUnavailable } from './renderers.js';
import type { ReportSection, ReportTemplate, SectionScope } from './template.js';
import {
  type BuildReportDeps,
  type FactContext,
  type FactProvider,
  type InterpretationRequest,
  type ReportBuildResult,
  type SectionOutput,
} from './engine.types.js';
import { sectorsOf } from './section-sectors.js';

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
      // Темы, закреплённые за секцией в шаблоне, добавляются как обязательные.
      const section = deps.template.sections.find((item) => item.id === request.id);
      request.knowledge = deps.knowledge.promptBlock({
        section: request.id,
        sectors,
        maxChars,
        required: section?.knowledge.length ? section.knowledge : undefined,
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

/** Проверка, что провайдеры шаблона зарегистрированы: ошибка конфигурации. */
export const missingProviders = (
  template: ReportTemplate,
  providers: ReadonlyMap<string, FactProvider>,
): string[] =>
  [...new Set(template.sections.map((section) => section.provider))].filter(
    (id) => !providers.has(id),
  );

export { composeMarkdown } from './compose.js';
export type { ReportSection };

export type {
  BuildReportDeps,
  FactContext,
  FactProvider,
  InterpretationRequest,
  ReportBuildResult,
  SectionFacts,
  SectionOutput,
} from './engine.types.js';
