import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  formatKnowledgeAnswer,
  type KnowledgeProvider,
} from '../../../capabilities/knowledge/index.js';
import type { AgentStateType } from '../../graph/state.js';

export interface KnowledgeDeps {
  knowledge: KnowledgeProvider;
  /**
   * Модель-эксперт: объясняет понятие и применяет его к вопросу. Без модели
   * остаётся детерминированная выжимка темы — ответ по справке, а не заготовка.
   */
  model?: BaseChatModel;
}

/** Последний вопрос пользователя: по нему ищем тему в базе. */
const lastQuestion = (state: AgentStateType): string => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    const type = (message as unknown as { _getType?: () => string })._getType?.();
    if (type === 'human') {
      return typeof message.content === 'string' ? message.content : '';
    }
  }
  return '';
};

/** Роль эксперта: знания — рамка рассуждения, цифры — только из данных. */
export const KNOWLEDGE_SYSTEM_PROMPT = [
  'Ты — инвестиционный эксперт с базой знаний по циклам, мультипликаторам, диверсификации,',
  'психологии инвесторов, налогам и истории кризисов. Отвечай на русском языке по существу.',
  'Объясни понятие своими словами и примени его к вопросу пользователя: что это меняет для его денег.',
  'Не выдумывай цифры, ставки и цены: если для примера нужны числа, помечай их как иллюстрацию (оценка).',
  'Если в справке нет нужного раздела — отвечай из общих принципов и честно скажи, что это общая практика.',
  'В конце одной строкой напомни, что это справочная информация, а не индивидуальная инвестиционная рекомендация.',
].join(' ');

/**
 * Узел справочного ответа: объясняет инвестиционное понятие. Темы и их проверка
 * живут в `KnowledgeService`; узел решает, кто отвечает — модель-эксперт или
 * выжимка темы (когда модели нет или она недоступна).
 */
export const createKnowledgeNode =
  (deps: KnowledgeDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const question = lastQuestion(state);
    const topic = deps.knowledge.topicFor(question);
    const reference = topic ? formatKnowledgeAnswer(topic) : '';

    let answer: string | undefined;
    if (deps.model) {
      try {
        const response = await deps.model.invoke([
          new SystemMessage(
            reference.length > 0
              ? `${KNOWLEDGE_SYSTEM_PROMPT}\n\nСправка из базы знаний:\n${reference}`
              : `${KNOWLEDGE_SYSTEM_PROMPT}\n\nСправки по этой теме в базе знаний нет: ` +
                  'отвечай общими принципами и скажи, что это общая практика, а не выдержка из базы.',
          ),
          new HumanMessage(question),
        ]);
        const text = typeof response.content === 'string' ? response.content.trim() : '';
        answer = text.length > 0 ? text : undefined;
      } catch {
        // Модель недоступна — отвечаем выжимкой темы, а не ошибкой.
      }
    }

    return {
      intent: 'knowledge_question',
      messages: [new AIMessage(answer ?? (reference.length > 0 ? reference : deps.knowledge.miss()))],
      partial: false,
      dataAsOf: new Date().toISOString(),
    };
  };
