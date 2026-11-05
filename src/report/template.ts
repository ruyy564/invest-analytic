import { readFileSync } from 'node:fs';
import { ConfigError } from '../config/config.error.js';
import { parseYaml } from '../parsing/yaml.js';

export const REPORT_PERIODS = ['1d', '7d', '30d', '180d'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Области разбора: секция может показываться не во всех. */
export const SECTION_SCOPES = ['portfolio', 'account', 'instrument'] as const;
export type SectionScope = (typeof SECTION_SCOPES)[number];

export const RENDER_KINDS = ['table', 'distribution', 'list', 'kpi', 'text'] as const;
export type RenderKind = (typeof RENDER_KINDS)[number];

export interface ReportSection {
  id: string;
  title: string;
  /** Поставщик фактов: имя из реестра провайдеров. */
  provider: string;
  render: RenderKind;
  params: Record<string, unknown>;
  /** Секцию формулирует модель, а не код. */
  interpret: boolean;
  /** В каких разборах показывать секцию; пусто — во всех. */
  scopes: SectionScope[];
}

export interface ReportThresholds {
  concentrationHigh: number;
  concentrationMedium: number;
  minClassShare: number;
}

export interface ReportTemplate {
  id: string;
  version: number;
  periods: ReportPeriod[];
  thresholds: ReportThresholds;
  sections: ReportSection[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown, field: string, issues: string[]): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) {
    issues.push(`порог "${field}" должен быть числом`);
    return 0;
  }
  return parsed;
};

/**
 * Проверка шаблона: битый файл — ошибка конфигурации на старте, а не пустой
 * отчёт. Схема описана в docs/reports.md.
 */
export const parseReportTemplate = (raw: unknown, source: string): ReportTemplate => {
  const issues: string[] = [];
  const root = asRecord(raw);

  const id = typeof root.id === 'string' ? root.id.trim() : '';
  if (!id) {
    issues.push('не указан id шаблона');
  }
  const version = asNumber(root.version, 'version', issues);

  const periodsRaw = Array.isArray(root.periods) ? root.periods : [];
  const periods = periodsRaw
    .map((period) => String(period))
    .filter((period): period is ReportPeriod =>
      (REPORT_PERIODS as readonly string[]).includes(period),
    );
  if (periods.length === 0) {
    issues.push(`periods: ожидаются значения из ${REPORT_PERIODS.join(', ')}`);
  }

  const rawThresholds = asRecord(root.thresholds);
  const thresholds: ReportThresholds = {
    concentrationHigh: asNumber(
      rawThresholds.concentration_high ?? 0.5,
      'concentration_high',
      issues,
    ),
    concentrationMedium: asNumber(
      rawThresholds.concentration_medium ?? 0.25,
      'concentration_medium',
      issues,
    ),
    minClassShare: asNumber(rawThresholds.min_class_share ?? 0.05, 'min_class_share', issues),
  };

  const rawSections = Array.isArray(root.sections) ? root.sections : [];
  const sections: ReportSection[] = [];
  const seen = new Set<string>();

  rawSections.forEach((item, index) => {
    const section = asRecord(item);
    const sectionId = typeof section.id === 'string' ? section.id.trim() : '';
    if (!sectionId) {
      issues.push(`секция #${index + 1}: не указан id`);
      return;
    }
    if (seen.has(sectionId)) {
      issues.push(`секция "${sectionId}" указана дважды`);
      return;
    }
    seen.add(sectionId);

    const provider = typeof section.provider === 'string' ? section.provider.trim() : '';
    if (!provider) {
      issues.push(`секция "${sectionId}": не указан provider`);
    }
    const render = String(section.render ?? 'text');
    if (!(RENDER_KINDS as readonly string[]).includes(render)) {
      issues.push(`секция "${sectionId}": неизвестный тип вывода "${render}"`);
    }
    const scopesRaw = Array.isArray(section.scopes) ? section.scopes.map(String) : [];
    const scopes = scopesRaw.filter((scope): scope is SectionScope =>
      (SECTION_SCOPES as readonly string[]).includes(scope),
    );
    if (scopesRaw.length !== scopes.length) {
      issues.push(
        `секция "${sectionId}": scopes — ожидаются значения из ${SECTION_SCOPES.join(', ')}`,
      );
    }
    sections.push({
      id: sectionId,
      title: typeof section.title === 'string' ? section.title : sectionId,
      provider,
      render: render as RenderKind,
      params: asRecord(section.params ?? section.params),
      interpret: section.interpret === true,
      // Пусто — секция общая для всех разборов.
      scopes: scopes.length > 0 ? scopes : [...SECTION_SCOPES],
    });
  });

  if (sections.length === 0) {
    issues.push('в шаблоне нет секций');
  }

  if (issues.length > 0) {
    throw new ConfigError(issues.map((issue) => `${source}: ${issue}`));
  }

  return { id, version, periods, thresholds, sections };
};

/** Загрузка шаблона из файла: YAML-подмножество, JSON тоже подходит. */
export const loadReportTemplate = (path: string): ReportTemplate => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError([`REPORT_TEMPLATE_FILE: не удалось прочитать ${path}: ${(error as Error).message}`]);
  }
  try {
    const parsed = text.trimStart().startsWith('{')
      ? (JSON.parse(text) as unknown)
      : parseYaml(text);
    return parseReportTemplate(parsed, path);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError([`REPORT_TEMPLATE_FILE: ${path}: ${(error as Error).message}`]);
  }
};

/** Имена поставщиков, нужные шаблону: из них строится план сбора. */
export const templateProviders = (template: ReportTemplate, scope?: SectionScope): string[] => [
  ...new Set(
    template.sections
      .filter((section) => !scope || section.scopes.includes(scope))
      .map((section) => section.provider),
  ),
];
