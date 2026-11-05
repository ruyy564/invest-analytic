import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { withTimeout } from '../../../mcp/mcp-tool.adapter.js';
import { buildReport, composeMarkdown, type ReportBuildResult } from '../../../report/engine.js';
import { createProviderMap } from '../../../report/providers/index.js';
import type { PlanEntry } from '../../../collection/plan.js';
import type { AgentStateType } from '../../graph/state.js';
import { templateOf, type ReviewDeps } from './deps.js';
import { collectionFromState } from './collect.node.js';
import { cleanSection, INTERPRETATION_TIMEOUT_MS, loadInterpretationPrompt } from './interpretation.js';

export const createReportNode =
  (deps: ReviewDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const collected = collectionFromState(state);

    const report = buildReport({
      template,
      providers: createProviderMap(),
      plan: {
        entries: state.readingPlan as PlanEntry[],
        maxInstruments: deps.config.value.run.reviewMaxInstruments,
      },
      collected,
      scope: state.scope ?? 'portfolio',
      scopeTarget: state.scopeTarget,
      // База знаний — сервис с кэшем: файлы читаются один раз, отсутствие каталога не мешает.
      knowledge: deps.knowledge.isEmpty ? undefined : deps.knowledge,
      knowledgeMaxChars: deps.config.value.run.knowledgeMaxChars,
    });

    const interpretation: Record<string, string> = {};
    if (report.interpretation.length > 0 && deps.model) {
      const prompt = loadInterpretationPrompt(deps.config.value.report.interpretationPromptFile);
      // По вызову на раздел: модель отвечает свободным текстом, а не разметкой
      // «macro: …». Вызовы идут последовательно — GigaChat не любит параллель.
      for (const request of report.interpretation) {
        const instructions = [
          prompt,
          `Сейчас ты пишешь только раздел «${request.title}» (код раздела: ${request.id}).`,
          'Верни только текст раздела: без заголовков markdown и без префикса с кодом раздела.',
          // Справочный блок — принципы трактовки; числа остаются из брифинга.
          request.knowledge,
        ]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('\n');
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await withTimeout(
              deps.model?.invoke([
                new SystemMessage(instructions),
                new HumanMessage(request.brief),
              ]) ?? Promise.reject(new Error('модель недоступна')),
              INTERPRETATION_TIMEOUT_MS,
              () => new Error('llm timeout'),
            );
            const text = typeof response.content === 'string' ? response.content : '';
            const cleaned = cleanSection(text, request.id);
            if (cleaned.length > 0) {
              interpretation[request.id] = cleaned;
              break;
            }
            console.warn(`[report] раздел ${request.id}: пустой ответ модели`);
          } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            console.warn(`[report] раздел ${request.id} не сформирован:`, message.slice(0, 200));
            // Одна повторная попытка: сеть и лимиты модели дают сбои на короткое время.
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
    }

    const markdown = composeMarkdown(report, interpretation, state.scopeLabel);
    const partial =
      report.partial || Object.keys(interpretation).length < report.interpretation.length;

    return {
      messages: [new AIMessage(markdown)],
      reportId: report.reportId,
      reportTemplateVersion: report.templateVersion,
      reportType: 'deep_review',
      partial,
      dataAsOf: report.asOf,
    };
  };

export type { ReportBuildResult };
