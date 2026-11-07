import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describeError, lastAnswer } from '../../src/agent/runner/runner.helpers.js';

describe('ответ прогона', () => {
  it('пустой ответ текущего прогона не превращается в текст прошлого вопроса', () => {
    // Иначе снаружи это выглядело как «ассистент ответил тем же, что и раньше».
    const answer = lastAnswer([
      new HumanMessage('что в портфеле?'),
      new AIMessage('В портфеле 100 акций SBER.'),
      new HumanMessage('а дивиденды?'),
      new AIMessage(''),
    ] as never);

    expect(answer).toBeUndefined();
  });

  it('находит последний содержательный текст текущего прогона', () => {
    const answer = lastAnswer([
      new HumanMessage('что в портфеле?'),
      new AIMessage('В портфеле 100 акций SBER.'),
      new HumanMessage('а дивиденды?'),
      new AIMessage('Дивиденды: 33,30 на акцию.'),
    ] as never);

    expect(answer).toBe('Дивиденды: 33,30 на акцию.');
  });
});

describe('описание ошибки провайдера', () => {
  it('достаёт статус и тело ответа из ошибки GigaChat', () => {
    // Библиотека кладёт в `message` объект, поэтому в логе было «[object Object]».
    const error = Object.assign(new Error('[object Object]' as unknown as string), {
      response: { status: 422, data: { message: 'invalid request: too many tokens' } },
    });
    error.message = '[object Object]';
    (error as unknown as { message: unknown }).message = { detail: 'x' };

    const text = describeError(error);

    expect(text).toContain('ошибка провайдера');
    expect(text).toContain('[422]');
    expect(text).toContain('too many tokens');
  });

  it('оставляет обычную ошибку как есть', () => {
    expect(describeError(new Error('deadline'))).toBe('deadline');
    expect(describeError('строка')).toBe('строка');
  });
});
