import {
  factsFallback,
  interpretSection,
  isRefusalFallback,
  neutralizeBrief,
  stripSensitive,
} from '../../src/agent/nodes/review/report.node.js';

const BRIEF = 'SBER (финансы) | цена 292,32 RUB | потенциал +30,63 %';

describe('нейтрализация брифинга для модели', () => {
  it('убирает слова-рекомендации, сохраняя смысл оценки', () => {
    // «покупать» в брифинге GigaChat читал как инвестиционную рекомендацию и отказывался.
    const brief = 'аналитики: покупать, цель 383,80 | цена 293,98 RUB';

    const neutral = neutralizeBrief(brief);

    expect(neutral).toContain('позитивный взгляд аналитиков');
    expect(neutral).not.toContain('покупать');
    expect(neutral).toContain('293,98');
  });

  it('вторая попытка выбрасывает политические сюжеты, но не факты бумаги', () => {
    const brief = [
      'SBER (финансы) | цена 293,98 RUB',
      'фон рынка: Во Франции 146 тыс. человек вышли на демонстрации против роста стоимости жизни',
      'влияет: санкции — давление на сектор',
      'дивиденды: доходность 13,49 %',
    ].join(' | ');

    const clean = stripSensitive(brief);

    expect(clean).toContain('цена 293,98 RUB');
    expect(clean).toContain('доходность 13,49');
    expect(clean).not.toContain('демонстрации');
    expect(clean).not.toContain('санкции');
  });
});

describe('трактовка раздела отчёта', () => {
  it('отказ модели заменяется фактами брифинга, а не дисклеймером провайдера', () => {
    const refusal =
      'Как и любая языковая модель, GigaChat не обладает собственным мнением и не транслирует ' +
      'мнение своих разработчиков. Разговоры на некоторые темы временно ограничены.';

    const section = interpretSection(refusal, BRIEF, 'conclusion') ?? '';

    expect(section).toContain('• SBER (финансы)');
    expect(section).toContain('• цена 292,32 RUB');
    expect(section).toContain('Трактовка модели недоступна');
    expect(isRefusalFallback(section)).toBe(true);
    expect(section).not.toContain('не обладает собственным мнением');
  });

  it('обычный текст модели остаётся как есть', () => {
    const section = interpretSection('Цена ниже цели аналитиков.', BRIEF, 'conclusion');

    expect(section).toBe('Цена ниже цели аналитиков.');
    expect(isRefusalFallback(section as string)).toBe(false);
  });

  it('пустой ответ — undefined, факты не подставляются', () => {
    expect(interpretSection('   ', BRIEF, 'conclusion')).toBeUndefined();
  });

  it('факты брифинга разбиваются на строки списка', () => {
    const fallback = factsFallback(BRIEF);

    expect(fallback.split('\n')[0]).toBe('• SBER (финансы)');
    expect(fallback).toContain('\n• цена 292,32 RUB');
  });
});
