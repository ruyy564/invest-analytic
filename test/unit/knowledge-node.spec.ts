import { HumanMessage } from '@langchain/core/messages';
import { createKnowledgeNode } from '../../src/agent/nodes/knowledge/index.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

/** Провайдер знаний: тема есть, ответ-справка предсказуем. */
const provider = (topicTitle = 'Диверсификация') =>
  ({
    isEmpty: false,
    topicFor: () =>
      topicTitle === ''
        ? undefined
        : {
            id: 'diversification',
            title: topicTitle,
            summary: 'Диверсификация снижает риск портфеля.',
            points: ['Разные классы активов падают не одновременно'],
            details: [],
            pitfalls: [],
            sources: [],
            keywords: [],
            sectors: [],
            sections: [],
          },
    miss: () => 'В базе знаний нет темы по этому вопросу.',
  }) as never;

const state = (question: string) =>
  ({ messages: [new HumanMessage(question)] }) as never;

const textOf = (result: { messages?: unknown[] }): string =>
  String(
    ((result.messages?.[0] as { content?: unknown } | undefined)?.content as string | undefined) ?? '',
  );

describe('узел справочного ответа', () => {
  it('отвечает моделью-экспертом по теме базы знаний', async () => {
    // Раньше узел отдавал сохранённую выжимку темы: пользователь получал
    // заготовку из файла, а не разбор эксперта.
    const model = new ScriptedChatModel(['Диверсификация — это про то, что не всё падает сразу.']);
    const node = createKnowledgeNode({ knowledge: provider(), model });

    const result = await node(state('что такое диверсификация?'));

    expect(textOf(result)).toBe('Диверсификация — это про то, что не всё падает сразу.');
  });

  it('без модели отдаёт выжимку темы, а не пустой ответ', async () => {
    const node = createKnowledgeNode({ knowledge: provider() });

    const result = await node(state('что такое диверсификация?'));

    expect(textOf(result)).toContain('Диверсификация');
    expect(textOf(result)).toContain('снижает риск портфеля');
  });

  it('без темы и без модели честно говорит, что темы нет', async () => {
    const node = createKnowledgeNode({ knowledge: provider('') });

    const result = await node(state('что такое стейкинг?'));

    expect(textOf(result)).toContain('нет темы');
  });

  it('без темы, но с моделью отвечает общими принципами', async () => {
    const model = new ScriptedChatModel(['Общая практика: стейкинг — это способ заработка на сети.']);
    const node = createKnowledgeNode({ knowledge: provider(''), model });

    const result = await node(state('что такое стейкинг?'));

    expect(textOf(result)).toContain('Общая практика');
  });
});
