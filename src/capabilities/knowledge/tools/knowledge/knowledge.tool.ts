import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../../transports/mcp/tool-schema.js';
import type { KnowledgeProvider } from '../../index.js';

/**
 * Тонкий инструмент для модели: объяснение инвестиционного понятия.
 * Правила поиска и формат ответа живут в `KnowledgeService`, здесь только схема,
 * описание и вызов — как в учебных примерах, где тул занимает 20 строк.
 */
export const createKnowledgeTool = (knowledge: KnowledgeProvider): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'knowledge__explain',
    description:
      'Объяснить инвестиционное понятие по внутренней базе знаний: циклы, мультипликаторы, ' +
      'диверсификация, психология решений, зависимости секторов, история кризисов. ' +
      'Звать, когда спрашивают «что такое …» или просят объяснить принцип. ' +
      'Для данных портфеля и цен этот инструмент не нужен.',
    schema: toZodV3({
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Вопрос пользователя целиком, например «что такое P/E»',
        },
      },
      required: ['question'],
    }) as never,
    func: async (input: unknown) => {
      const question = String((input as { question?: unknown })?.question ?? '');
      return knowledge.answerFor(question) ?? knowledge.miss();
    },
  } as never);
