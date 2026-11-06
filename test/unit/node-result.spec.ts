import {
  NodeResultSchema,
  analysisResult,
  reportOfState,
  reportResult,
} from '../../src/agent/results/index.js';

describe('типизированный результат узла', () => {
  it('отчёт помечается видом report и причиной остановки', () => {
    const result = reportResult('# Отчёт', {
      coverage: [{ source: 'news', status: 'missing', reason: 'таймаут' }],
      partial: true,
    });

    expect(result.kind).toBe('report');
    expect(result.partial).toBe(true);
    expect(result.stopReason).toBe('no_data');
    expect(result.coverage[0]).toMatchObject({ source: 'news', status: 'missing' });
  });

  it('текст модели не считается отчётом', () => {
    const result = analysisResult('Цена выросла');

    expect(result).toMatchObject({ kind: 'analysis', payload: 'Цена выросла', partial: false });
    expect(reportOfState({ lastResult: result })).toBeUndefined();
  });

  it('переживает сериализацию в чекпоинт и обратно', () => {
    const result = reportResult('# Отчёт', { coverage: [{ source: 'prices', status: 'ok' }] });

    const restored = NodeResultSchema.parse(JSON.parse(JSON.stringify(result)) as unknown);

    expect(restored).toEqual(result);
    expect(reportOfState({ lastResult: restored })?.payload).toBe('# Отчёт');
  });

  it('невалидный результат отбрасывается схемой', () => {
    expect(NodeResultSchema.safeParse({ kind: 'unknown', payload: 'x' }).success).toBe(false);
  });
});
