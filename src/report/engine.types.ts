import type { CollectionResult } from '../collection/executor.js';
import type { CollectionPlan } from '../collection/plan.js';
import type { KnowledgeProvider } from '../knowledge/index.js';
import type { CoverageEntry } from '../news/news.registry.js';
import type { ReportTemplate, SectionScope } from './template.js';

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

