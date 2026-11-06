import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfigService } from '../../../platform/config/app-config.service.js';
import type { KnowledgeService } from '../../../capabilities/knowledge/index.js';
import type { McpRegistryService } from '../../../transports/mcp/mcp-registry.service.js';
import { loadReportTemplate, type ReportTemplate } from '../../../capabilities/reports/template.js';

export interface ReviewDeps {
  config: AppConfigService;
  registry: McpRegistryService;
  model?: BaseChatModel;
  /** База знаний: справочный контекст интерпретируемых разделов. */
  knowledge: KnowledgeService;
  /** Шаблон читается один раз: файл не должен меняться в середине прогона. */
  template?: ReportTemplate;
}

export const templateOf = (deps: ReviewDeps): ReportTemplate =>
  deps.template ?? loadReportTemplate(deps.config.value.report.templateFile);

/** Открытые счета для плана: служебное чтение без подтверждения. */
