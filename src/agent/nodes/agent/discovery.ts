import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { INSTRUMENT_TOOLS } from '../../../capabilities/instruments/tools/instruments.tools.js';

/**
 * Поиск эмитента до ответа модели.
 *
 * «Что случилось с самолетом?» — слово в вопросе может быть названием компании
 * (ГК «Самолет», SMLT), а не бытовым понятием. Если детектор бумаг не нашёл тикер,
 * узел сам вызывает `instruments__find` и отдаёт модели карточку: переспрашивать
 * «о каком самолёте речь» больше не нужно.
 */

/** Служебные и предметные слова: из них не получится название компании. */
const STOP_WORDS = new Set(
  (
    'что кто как почему зачем какие какой какая каких когда где сколько стоит ли мне мой мои моих ' +
    'меня с со про по на в во и а но или это этот эта эти такой такая такие такое такие бумага бумаги бумагу ' +
    'бумагами бумаге акция акции акций акцию акциях акциями облигация облигации облигаций ' +
    'облигациях тикер тикера компания ' +
    'компании компанию компании эмитент эмитента эмитентом рынок рынка рынке новости новость ' +
    'новостей цена цену цены ценах ценой ценами дивиденды дивиденд дивидендов динамика динамику ' +
    'динамике случилось происходит ' +
    'расскажи покажи разбери дай можно нужно сейчас последние последний последнюю за полгода год ' +
    'месяц месяца неделя неделю сегодня вчера продавать покупать купить держать анализ разбор ' +
    'портфель портфеля ставка ставки инфляция инфляции экономика экономики знать скажи объясни ' +
    'хочу планирую посмотреть посмотри что-то ещё еще вообще дела делах дел ситуация ситуацию ' +
    'важная важное важные главное главные'
  ).split(/\s+/),
);

/** Маркеры: вопрос действительно про бумагу или эмитента. */
const SECURITY_HINTS =
  /что\s+(?:с|случилось|происходит|за)(?![а-яё])|что\s+за\s+(?:бумаг|акци|компани|эмитент|тикер)|акци|бумаг|тикер|эмитент|котировк|дивиденд|стоит\s+ли\s+(?:покупать|брать)|как\s+дела\s+с/i;

/** Падежные окончания: поиск бумаги идёт по названию в именительном падеже. */
const CASE_ENDINGS = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ах', 'ях', 'ов', 'ев', 'ом', 'ем', 'ой', 'ей', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о'];

/** Основа слова: «самолетом» → «самолет», «цианом» → «циан». */
export const stemWord = (word: string): string => {
  if (word.length <= 5) {
    return word;
  }
  for (const ending of CASE_ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
};

/** Слова вопроса, которые могут быть названием компании или тикером. */
export const companyCandidates = (question: string): string[] => {
  const words = question
    .toLowerCase()
    .replace(/[?!.,;:()"'«»]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !STOP_WORDS.has(word));
  // Одно-два слова: больше — это уже фраза, а не название.
  return [...new Set(words)].slice(0, 2);
};

/**
 * Тикеры, найденные инструментом в этом прогоне: результат поиска даёт брокерский
 * тикер, даже если в вопросе название стояло в падеже («сегежей» → SGZH).
 */
export const tickersFromFind = (messages: readonly BaseMessage[]): string[] => {
  const findIds = new Set<string>();
  for (const message of messages) {
    const type = (message as unknown as { _getType?: () => string })._getType?.();
    if (type !== 'ai') {
      continue;
    }
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (call.name === INSTRUMENT_TOOLS.find || call.name.endsWith(`__${INSTRUMENT_TOOLS.find}`)) {
        if (call.id) {
          findIds.add(call.id);
        }
      }
    }
  }
  const found = new Set<string>();
  for (const message of messages) {
    const type = (message as unknown as { _getType?: () => string })._getType?.();
    const id = (message as { tool_call_id?: string }).tool_call_id;
    if (type !== 'tool' || !id || !findIds.has(id)) {
      continue;
    }
    const text = typeof message.content === 'string' ? message.content : '';
    for (const match of text.matchAll(/ticker:\s*([A-Z0-9]{2,})/g)) {
      found.add(match[1]);
    }
  }
  return [...found];
};
export const discoveryCallFor = (
  question: string,
  tickers: readonly string[],
  messages: readonly BaseMessage[],
  tools: readonly StructuredToolInterface[],
): AIMessage | undefined => {
  if (tickers.length > 0 || !SECURITY_HINTS.test(question)) {
    return undefined;
  }
  const candidates = companyCandidates(question);
  if (candidates.length === 0) {
    return undefined;
  }
  const tool =
    tools.find((item) => item.name === INSTRUMENT_TOOLS.find) ??
    tools.find((item) => item.name.endsWith(`__${INSTRUMENT_TOOLS.find}`)) ??
    tools.find((item) => item.name === 'invest_find_instrument') ??
    tools.find((item) => item.name.endsWith('__invest_find_instrument'));
  if (!tool) {
    return undefined;
  }
  const stems = candidates.map(stemWord);
  const asked = messages.some((message) => {
    const type = (message as unknown as { _getType?: () => string })._getType?.();
    if (type !== 'ai') {
      return false;
    }
    const calls = (message as AIMessage).tool_calls ?? [];
    return calls.some(
      (call) =>
        (call.name === tool.name || call.name.endsWith(`__${INSTRUMENT_TOOLS.find}`)) &&
        stems.includes(String((call.args as { query?: unknown })?.query ?? '').toLowerCase()),
    );
  });
  if (asked) {
    return undefined;
  }
  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id: `find-${Date.now()}`,
        name: tool.name,
        args: { query: stemWord(candidates[0]) },
      },
    ],
  });
};
