import { HumanMessage } from '@langchain/core/messages';
import { createClassifyNode } from '../../src/agent/nodes/classify.node.js';
import { OFF_TOPIC_PATTERN } from '../../src/agent/prompts/classifier.prompt.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

/**
 * Справочный вопрос по инвестиционному понятию: правило должно срабатывать до
 * эвристик «разбор портфеля» (иначе «что такое диверсификация» уходит в отчёт).
 */
const classify = async (question: string): Promise<string | undefined> => {
  const node = createClassifyNode(new ScriptedChatModel(['data_lookup']));
  const result = await node({ messages: [new HumanMessage(question)] } as never);
  return result.intent;
};

describe('справочный интент по понятию', () => {
  it('распознаёт вопрос о понятии из базы знаний', async () => {
    expect(await classify('что такое мультипликатор P/E?')).toBe('knowledge_question');
    expect(await classify('что такое диверсификация?')).toBe('knowledge_question');
    expect(await classify('объясни, что такое экономические циклы')).toBe('knowledge_question');
    expect(await classify('как влияют цены на металлы на эмитентов?')).toBe('knowledge_question');
  });

  it('не перехватывает вопросы о своём портфеле и бумагах', async () => {
    expect(await classify('что у меня в портфеле?')).not.toBe('knowledge_question');
    expect(await classify('насколько диверсифицирован мой портфель?')).not.toBe(
      'knowledge_question',
    );
    expect(await classify('разбери бумагу SBER')).not.toBe('knowledge_question');
    expect(await classify('что такое мой счёт?')).not.toBe('knowledge_question');
  });

  it('посторонние темы остаются отказом, понятия — в области', () => {
    expect(OFF_TOPIC_PATTERN.test('какая погода в Москве?')).toBe(true);
    expect(OFF_TOPIC_PATTERN.test('что такое мультипликатор P/E')).toBe(false);
    expect(OFF_TOPIC_PATTERN.test('что такое диверсификация')).toBe(false);
  });
});
