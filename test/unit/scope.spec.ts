import { detectScope, PORTFOLIO_SCOPE } from '../../src/agent/scope.js';

const ALIASES = {
  SBER: ['Сбер', 'Сбербанк'],
  LKOH: ['ЛУКОЙЛ'],
  PLZL: ['Полюс'],
};

describe('область разбора', () => {
  it('по умолчанию разбираем портфель', () => {
    expect(detectScope('проанализируй мой портфель')).toEqual(PORTFOLIO_SCOPE);
    expect(detectScope('что у меня в портфеле?')).toEqual(PORTFOLIO_SCOPE);
  });

  it('узнаёт бумагу по тикеру рядом с маркером', () => {
    expect(detectScope('разбери бумагу SBER')).toMatchObject({
      scope: 'instrument',
      target: 'SBER',
      label: 'бумаги SBER',
    });
    expect(detectScope('проанализируй акции PLZL')).toMatchObject({ scope: 'instrument', target: 'PLZL' });
  });

  it('узнаёт бумагу по названию компании', () => {
    expect(detectScope('разбери Сбер', ALIASES)).toMatchObject({ scope: 'instrument', target: 'SBER' });
    expect(detectScope('что с Лукойлом?', ALIASES)).toMatchObject({ scope: 'instrument', target: 'LKOH' });
    expect(detectScope('проанализируй Полюс', ALIASES)).toMatchObject({
      scope: 'instrument',
      target: 'PLZL',
    });
  });

  it('узнаёт счёт по названию, а номер оставляет как запасной вариант', () => {
    // Пользователь называет счёт словами — так и подписываем ответ.
    expect(detectScope('разбери счёт Портфельное инвестирование')).toMatchObject({
      scope: 'account',
      target: 'Портфельное',
      label: 'счёта Портфельное',
    });
    expect(detectScope('проанализируй счёт брокерский')).toMatchObject({
      scope: 'account',
      target: 'брокерский',
    });
    // Номер счёта тоже распознаём: им пользуются реже, но он однозначен.
    expect(detectScope('разбери счёт 1234567890')).toMatchObject({
      scope: 'account',
      target: '1234567890',
      label: 'счёта 1234567890',
    });
  });

  it('не считает бумагой случайное латинское слово без маркера', () => {
    expect(detectScope('привет, как дела')).toEqual(PORTFOLIO_SCOPE);
  });
});
