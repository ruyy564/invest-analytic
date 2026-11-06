import { runEventOf, toServerSentEvent } from '../../src/agent/runner/run-events.js';

describe('события прогона', () => {
  it('вызов инструмента: старт и результат', () => {
    expect(
      runEventOf({ event: 'on_tool_start', name: 'instruments__prices', data: { input: { ticker: 'SBER' } } }),
    ).toEqual({ type: 'tool_call', tool: 'instruments__prices', args: { ticker: 'SBER' } });

    expect(runEventOf({ event: 'on_tool_end', name: 'instruments__prices' })).toEqual({
      type: 'tool_result',
      tool: 'instruments__prices',
      ok: true,
    });
  });

  it('ошибка инструмента помечается как неуспех', () => {
    expect(
      runEventOf({ event: 'on_tool_error', name: 'news__search', data: { error: new Error('HTTP 429') } }),
    ).toEqual({ type: 'tool_result', tool: 'news__search', ok: false, error: 'HTTP 429' });
  });

  it('текст модели превращается в дельту, пустой чанк пропускается', () => {
    expect(runEventOf({ event: 'on_chat_model_stream', data: { chunk: { content: 'ц' } } })).toEqual({
      type: 'delta',
      text: 'ц',
    });
    expect(
      runEventOf({ event: 'on_chat_model_stream', data: { chunk: { content: '' } } }),
    ).toBeUndefined();
    expect(
      runEventOf({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ text: 'часть' }] } },
      }),
    ).toEqual({ type: 'delta', text: 'часть' });
  });

  it('интент берётся из результата классификатора', () => {
    expect(
      runEventOf({ event: 'on_chain_end', name: 'classify', data: { output: { intent: 'data_lookup' } } }),
    ).toEqual({ type: 'intent', intent: 'data_lookup' });
    expect(runEventOf({ event: 'on_chain_end', name: 'classify', data: {} })).toBeUndefined();
    expect(runEventOf({ event: 'on_chain_start', name: 'agent' })).toBeUndefined();
  });

  it('кадр SSE содержит имя события и JSON-данные', () => {
    const frame = toServerSentEvent({ type: 'run_started', runId: 'run-1' });

    expect(frame).toBe('event: run_started\ndata: {"type":"run_started","runId":"run-1"}\n\n');
  });
});
