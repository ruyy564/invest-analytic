import { Injectable } from '@nestjs/common';
import { CHECKLIST_SECTIONS, DEFAULT_KNOWLEDGE_MAX_CHARS } from './knowledge.constants.js';
import {
  formatKnowledge,
  formatKnowledgeAnswer,
  formatKnowledgeMiss,
  withPreamble,
} from './knowledge.format.js';
import { KnowledgeRepository } from './knowledge.repository.js';
import { findTopicForQuestion, selectTopics } from './knowledge.select.js';
import type {
  KnowledgeProvider,
  KnowledgeQuery,
  KnowledgeTopic,
} from './knowledge.types.js';

/**
 * Бизнес-логика базы знаний: какие темы относятся к разделу и секторам, что
 * показать модели, что ответить пользователю. Не знает про MCP, граф и HTTP —
 * поэтому её используют и тул, и нода, и движок отчёта.
 */
@Injectable()
export class KnowledgeService implements KnowledgeProvider {
  constructor(private readonly repository: KnowledgeRepository) {}

  /** Темы каталога: нужны инструменту и справке. */
  get topics(): readonly KnowledgeTopic[] {
    return this.repository.load().topics;
  }

  /** Ветка знаний имеет смысл, только когда темы загрузились. */
  get isEmpty(): boolean {
    return this.topics.length === 0;
  }

  /** Темы под раздел отчёта, секторы портфеля и вопрос. */
  select(query: KnowledgeQuery = {}): KnowledgeTopic[] {
    return selectTopics(this.repository.load(), query);
  }

  /** Тема, о которой спрашивает пользователь. */
  topicFor(question: string): KnowledgeTopic | undefined {
    return findTopicForQuestion(this.repository.load(), question);
  }

  /** Блок для промпта с преамбулой «знания — трактовка, а не данные». */
  promptBlock(
    query: KnowledgeQuery & { maxChars?: number; requireChecklist?: boolean },
  ): string | undefined {
    const checklist =
      query.requireChecklist !== false &&
      query.section !== undefined &&
      CHECKLIST_SECTIONS.includes(query.section)
        ? ['decision-checklist']
        : [];
    // Темы из шаблона отчёта (если заданы) идут вместе с обязательным чек-листом.
    const required = [...new Set([...(query.required ?? []), ...checklist])];
    const topics = this.select({ ...query, required });
    return withPreamble(formatKnowledge(topics, query.maxChars ?? DEFAULT_KNOWLEDGE_MAX_CHARS));
  }

  /** Полный ответ по теме; `undefined` — темы нет. */
  answerFor(question: string): string | undefined {
    const topic = this.topicFor(question);
    return topic ? formatKnowledgeAnswer(topic) : undefined;
  }

  /** Ответ «темы нет» со списком доступных. */
  miss(): string {
    return formatKnowledgeMiss(this.repository.load());
  }
}
