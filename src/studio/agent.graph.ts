import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

/**
 * LangGraph Server для LangSmith Studio: `langgraphjs dev` читает этот файл,
 * поднимает API на 127.0.0.1:2024 и показывает граф на канвасе.
 *
 * Это витрина реального графа приложения (`classify → offTopic` либо
 * `agent → approve → tools`): те же узлы и пауза подтверждения через `interrupt`,
 * но с заглушкой вместо LLM и MCP — Studio нужен только для наглядности и отладки,
 * рабочий сервис остаётся NestJS-приложением.
 */
const DEMO_ANSWER =
  'Демо-режим Studio: реальные данные приходят только из NestJS-сервиса. ' +
  'Здесь показан маршрут графа: classify → agent → approve → tools.';

const State = Annotation.Root({
  messages: Annotation<unknown[]>({
    reducer: (left: unknown[], right: unknown[]) => left.concat(right),
    default: () => [],
  }),
  intent: Annotation<string>({
    reducer: (_left: string, right: string) => right,
    default: () => '',
  }),
});

type DemoState = typeof State.State;

/** Классификатор: в демо — по ключевым словам, без вызова LLM. */
const classify = (state: DemoState) => {
  const text = JSON.stringify(state.messages.at(-1) ?? '');
  const offTopic = /погода|налог|привет|курс доллара/i.test(text);
  return { intent: offTopic ? 'off_topic' : 'portfolio' };
};

const offTopic = () => ({
  messages: [new AIMessage('Это вне моей компетенции: я отвечаю про портфель.')],
});

const agent = () => ({ messages: [new AIMessage(DEMO_ANSWER)] });

/** Пауза подтверждения — тот же `interrupt`, что и в рабочем узле `approve`. */
const approve = () => {
  const decision = interrupt({
    question: 'Прочитать данные портфеля у брокера?',
    actions: [{ tool: 'tinkoff__invest_get_portfolio', label: 'Состав портфеля' }],
  }) as { approved?: boolean };
  return { intent: decision?.approved ? 'approved' : 'declined' };
};

const tools = () => ({
  messages: [new HumanMessage('tinkoff__invest_get_portfolio: позиций нет (демо-заглушка).')],
});

const afterClassify = (state: DemoState) => (state.intent === 'off_topic' ? 'offTopic' : 'agent');

export const graph = new StateGraph(State)
  .addNode('classify', classify)
  .addNode('offTopic', offTopic)
  .addNode('agent', agent)
  .addNode('approve', approve)
  .addNode('tools', tools)
  .addEdge(START, 'classify')
  .addConditionalEdges('classify', afterClassify, { offTopic: 'offTopic', agent: 'agent' })
  .addEdge('agent', 'approve')
  .addEdge('approve', 'tools')
  .addEdge('tools', END)
  .addEdge('offTopic', END)
  .compile();
