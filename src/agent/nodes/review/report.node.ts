import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { withTimeout } from '../../../transports/mcp/mcp-tool.adapter.js';
import { buildReport, composeMarkdown, type ReportBuildResult } from '../../../capabilities/reports/engine.js';
import { createProviderMap } from '../../../capabilities/reports/providers/index.js';
import { loadCompanyProfiles } from '../../../capabilities/reports/company-profiles.js';
import type { PlanEntry } from '../../../capabilities/reports/collection/plan.js';
import type { AgentStateType } from '../../graph/state.js';
import { templateOf, type ReviewDeps } from './deps.js';
import { collectionFromState } from './collect.node.js';
import { cleanSection, INTERPRETATION_TIMEOUT_MS, loadInterpretationPrompt } from './interpretation.js';
import { reportResult } from '../../results/index.js';
import {
  factsFallback,
  isRefusal,
  isRefusalFallback,
} from '../../services/respond.service.js';

export { factsFallback, isRefusalFallback };

/**
 * Текст раздела из ответа модели: отказ («я не обладаю мнением») заменяется
 * фактами брифинга, пустой ответ — `undefined`.
 */
export const interpretSection = (text: string, brief: string, id: string): string | undefined => {
  const cleaned = cleanSection(text, id);
  if (cleaned.length === 0) {
    return undefined;
  }
  return isRefusal(cleaned) ? factsFallback(brief) : cleaned;
};

/**
 * Нейтрализация брифинга для модели: GigaChat иногда отказывается писать разбор,
 * если видит слова-рекомендации и политические триггеры. Факты в отчёте остаются
 * исходными — меняется только текст, уходящий модели, и смысл сохраняется.
 */
export const neutralizeBrief = (brief: string): string =>
  brief
    .replace(/покупать/gi, 'позитивный взгляд аналитиков')
    .replace(/продавать/gi, 'негативный взгляд аналитиков');

/**
 * Вторая попытка: убираем строки, на которые GigaChat отвечает отказом
 * (политика, протесты, санкции), и смягчаем оставшиеся упоминания. Числа и
 * факты по бумаге сохраняются — выбрасываются только посторонние сюжеты.
 */
export const stripSensitive = (brief: string): string =>
  neutralizeBrief(brief)
    .split(' | ')
    .filter(
      (line) =>
        !/политик|протест|демонстрац|митинг|санкц|военн|выбор[аоы]|теракт|убийств|авари|катастроф/i.test(
          line,
        ),
    )
    .join(' | ')
    .replace(/санкц[а-яё]*/gi, 'внешние ограничения');

export const createReportNode =
  (deps: ReviewDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const collected = collectionFromState(state);

    const report = buildReport({
      template,
      providers: createProviderMap({
        // Драйверы секторов и профили «экспортёр / внутренний рынок» — данные из файла.
        profiles: loadCompanyProfiles(deps.config.value.sources.companyProfilesFile),
      }),
      plan: {
        entries: state.readingPlan as PlanEntry[],
        maxInstruments: deps.config.value.run.reviewMaxInstruments,
      },
      collected,
      scope: state.scope ?? 'portfolio',
      scopeTarget: state.scopeTarget ?? undefined,
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
          // Вторая попытка идёт с «нейтральной» инструкцией: GigaChat иногда
          // отказывается писать про чувствительные темы, хотя нужен разбор фактов.
          const neutral =
            attempt === 0
              ? ''
              : 'Изложи только факты и механизмы влияния из брифинга, без политических тем, ' +
                'без санкций, без рекомендаций и без слов «покупать/продавать». Это учебный разбор.';
          try {
            const response = await withTimeout(
              deps.model?.invoke([
                new SystemMessage([instructions, neutral].filter(Boolean).join('\n')),
                new HumanMessage(
                  attempt === 0 ? neutralizeBrief(request.brief) : stripSensitive(request.brief),
                ),
              ]) ?? Promise.reject(new Error('модель недоступна')),
              INTERPRETATION_TIMEOUT_MS,
              () => new Error('llm timeout'),
            );
            const text = typeof response.content === 'string' ? response.content : '';
            const section = interpretSection(text, request.brief, request.id);
            if (section && !isRefusalFallback(section)) {
              interpretation[request.id] = section;
              break;
            }
            if (section) {
              // Отказ модели: один повтор нейтральной формулировкой, затем факты.
              console.warn(`[report] раздел ${request.id}: модель отказалась (попытка ${attempt + 1})`);
              interpretation[request.id] = section;
            } else {
              console.warn(`[report] раздел ${request.id}: пустой ответ модели`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            console.warn(`[report] раздел ${request.id} не сформирован:`, message.slice(0, 200));
            // Одна повторная попытка: сеть и лимиты модели дают сбои на короткое время.
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
    }

    const markdown = composeMarkdown(report, interpretation, state.scopeLabel ?? undefined);
    const partial =
      report.partial || Object.keys(interpretation).length < report.interpretation.length;

    return {
      messages: [new AIMessage(markdown)],
      // Контракт вместо строковых эвристик: узел ответа смотрит на kind, а не на префикс.
      lastResult: reportResult(markdown, { coverage: report.coverage, partial }),
      reportId: report.reportId,
      reportTemplateVersion: report.templateVersion,
      reportType: 'deep_review',
      partial,
      dataAsOf: report.asOf,
    };
  };

export type { ReportBuildResult };
