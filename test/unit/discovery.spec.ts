import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { companyCandidates, discoveryCallFor, stemWord } from '../../src/agent/nodes/agent/discovery.js';

const tool = (name: string) => ({ name }) as never;
const TOOLS = [tool('instruments__find'), tool('news__search'), tool('instruments__meta')];

describe('поиск эмитента до ответа модели', () => {
  it('название в падеже приводится к основе', () => {
    // «что случилось с самолетом» → ищем «самолет», иначе поиск по названию не сработает.
    expect(stemWord('самолетом')).toBe('самолет');
    expect(stemWord('цианом')).toBe('циан');
    expect(stemWord('хэдхантером')).toBe('хэдхантер');
    expect(stemWord('лукойл')).toBe('лукойл');
  });

  it('кандидаты отбрасывают служебные и предметные слова', () => {
    expect(companyCandidates('что случилось с самолетом?')).toEqual(['самолетом']);
    expect(companyCandidates('какие акции купить сейчас?')).toEqual([]);
    expect(companyCandidates('что такое инфляция?')).toEqual([]);
  });

  it('вопрос про незнакомую бумагу вызывает поиск', () => {
    const call = discoveryCallFor('что случилось с цианом?', [], [], TOOLS);

    expect(call).toBeDefined();
    expect(call?.tool_calls?.[0]).toMatchObject({
      name: 'instruments__find',
      args: { query: 'циан' },
    });
  });

  it('если тикер уже распознан, поиск не нужен', () => {
    expect(discoveryCallFor('что с сбером?', ['SBER'], [], TOOLS)).toBeUndefined();
  });

  it('посторонние вопросы не запускают поиск бумаги', () => {
    expect(discoveryCallFor('какая погода в Москве?', [], [], TOOLS)).toBeUndefined();
  });

  it('повторный поиск того же слова не выполняется', () => {
    const history = [
      new HumanMessage('что случилось с цианом?'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'f1', name: 'instruments__find', args: { query: 'циан' } }],
      }),
    ];

    expect(discoveryCallFor('что случилось с цианом?', [], history, TOOLS)).toBeUndefined();
  });

  it('инструмент с префиксом сервера тоже находится', () => {
    const call = discoveryCallFor('что за бумага хэдхантер?', [], [], [
      tool('tinkoff__invest_find_instrument'),
    ]);

    expect(call?.tool_calls?.[0].name).toBe('tinkoff__invest_find_instrument');
  });
});
