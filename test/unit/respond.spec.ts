import {
  answerOf,
  factsFallback,
  isDataRefusal,
  isRefusal,
  isRefusalFallback,
} from '../../src/agent/services/index.js';
import { analysisResult, reportResult } from '../../src/agent/results/index.js';

describe('сервис ответа', () => {
  it('узнаёт отказ модели', () => {
    expect(isRefusal('Как и любая языковая модель, я не обладаю собственным мнением')).toBe(true);
    expect(isRefusal('Цена выросла на 2 %')).toBe(false);
  });

  it('узнаёт цензурный отказ провайдера в разных формулировках', () => {
    // GigaChat меняет формулировку отказа: без распознавания он попадал в отчёт.
    expect(
      isRefusal(
        'Генеративные языковые модели не обладают собственным мнением — их ответы являются ' +
          'обобщением информации. Чтобы избежать ошибок и неправильного толкования, ' +
          'разговоры на чувствительные темы могут быть ограничены.',
      ),
    ).toBe(true);
    expect(
      isRefusal(
        'Иногда генеративные языковые модели могут создавать некорректные ответы. ' +
          'Ответы на вопросы, связанные с чувствительными темами, временно ограничены.',
      ),
    ).toBe(true);
  });

  it('узнаёт отказ показать данные', () => {
    expect(isDataRefusal('Не могу предоставить данные, обратитесь к брокеру')).toBe(true);
    expect(isDataRefusal('В приложении брокера данные недоступны')).toBe(true);
    expect(isDataRefusal('Данные портфеля: 100 000 RUB')).toBe(false);
  });

  it('подставляет факты брифинга вместо отказа', () => {
    const text = factsFallback('SBER | цена 292,32 RUB');

    expect(text).toContain('• SBER');
    expect(text).toContain('• цена 292,32 RUB');
    expect(isRefusalFallback(text)).toBe(true);
  });

  it('отдаёт готовый отчёт и не подменяет анализ', () => {
    expect(answerOf({ lastResult: reportResult('# Отчёт') })).toBe('# Отчёт');
    expect(answerOf({ lastResult: analysisResult('текст модели') })).toBeUndefined();
    expect(answerOf({})).toBeUndefined();
  });
});
