import { baseToolName, toolsForQuestion } from '../../src/agent/nodes/agent/tool-scope.js';

const tools = [
  'instruments__find',
  'instruments__prices',
  'instruments__meta',
  'news__search',
  'market__factors',
  'market__price_dynamics',
  'portfolio__snapshot',
  'invest_get_share',
  'invest_get_bond',
  'invest_list_bonds',
  'invest_get_bond_events',
  'invest_get_orderbook',
  'invest_list_options',
  'invest_get_future',
  'invest_get_tech_analysis',
].map((name) => ({ name }));

const names = (question: string): string[] =>
  toolsForQuestion(tools, question).map((tool) => tool.name);

describe('отбор инструментов под вопрос', () => {
  it('базовый вопрос получает базовый набор без экзотики', () => {
    // Десятки определений инструментов в контексте путают модель и съедают токены:
    // опционы, стакан и свечи не нужны на вопрос «что с Сбером».
    const scoped = names('что с сбером?');

    expect(scoped).toContain('instruments__meta');
    expect(scoped).toContain('news__search');
    expect(scoped).toContain('invest_get_share');
    expect(scoped).not.toContain('invest_list_options');
    expect(scoped).not.toContain('invest_get_orderbook');
  });

  it('вопрос про облигации добавляет облигационные инструменты', () => {
    const scoped = names('какие облигации купить с офертой?');

    expect(scoped).toContain('invest_get_bond');
    expect(scoped).toContain('invest_get_bond_events');
    expect(scoped).toContain('invest_list_bonds');
  });

  it('вопрос про срочный рынок добавляет опционы и фьючерсы', () => {
    const scoped = names('что с фьючерсом на индекс?');

    expect(scoped).toContain('invest_get_future');
    expect(scoped).toContain('invest_list_options');
  });

  it('вопрос про график добавляет свечи и технический анализ', () => {
    const scoped = names('покажи график сбербанка');

    expect(scoped).toContain('invest_get_tech_analysis');
  });

  it('имена MCP с префиксом сервера сопоставляются по хвосту', () => {
    const prefixed = [
      { name: 'tinkoff__invest_get_share' },
      { name: 'tinkoff__invest_list_options' },
      { name: 'instruments__meta' },
    ];

    const scoped = toolsForQuestion(prefixed, 'что с сбером?');

    expect(scoped.map((tool) => tool.name)).toEqual([
      'tinkoff__invest_get_share',
      'instruments__meta',
    ]);
    expect(baseToolName('tinkoff__invest_get_share')).toBe('invest_get_share');
  });

  it('нестандартный набор не обнуляется', () => {
    // Новая интеграция с другими именами: лучше отдать всё, чем пустой список.
    const unusual = [{ name: 'custom__something' }];

    expect(toolsForQuestion(unusual, 'вопрос')).toEqual(unusual);
  });
});
