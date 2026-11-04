import {
  availableCapabilities,
  buildCapabilitiesAnswer,
  CAPABILITIES,
  CAPABILITIES_PATTERN,
  disabledCapabilitiesNote,
} from '../../src/agent/prompts/capabilities.js';

describe('справка о возможностях', () => {
  it('узнаёт вопрос про возможности в разных формулировках', () => {
    for (const question of [
      'что ты умеешь?',
      'чем можешь помочь?',
      'что здесь можно узнать',
      'кто ты?',
      'расскажи о себе',
      'твои возможности',
    ]) {
      expect(CAPABILITIES_PATTERN.test(question)).toBe(true);
    }
  });

  it('не считает справкой посторонний вопрос', () => {
    expect(CAPABILITIES_PATTERN.test('какая завтра погода в Москве?')).toBe(false);
    expect(CAPABILITIES_PATTERN.test('что у меня в портфеле?')).toBe(false);
  });

  it('перечисляет все возможности карты и примеры к ним', () => {
    const answer = buildCapabilitiesAnswer();

    for (const capability of CAPABILITIES) {
      expect(answer).toContain(capability.title);
      // Пример вопроса виден пользователю дословно.
      expect(answer).toContain(`«${capability.examples[0]}»`);
    }
    expect(answer).toContain('торговых операций не выполняю');
    expect(answer).toContain('не являются индивидуальной инвестиционной рекомендацией');
    expect(answer).toContain('что у меня в портфеле?');
  });

  it('называет счёт по имени, а не по номеру', () => {
    const answer = buildCapabilitiesAnswer();
    const account = CAPABILITIES.find((capability) => capability.id === 'account');

    expect(account?.examples[0]).toBe('разбери счёт Портфельное инвестирование');
    for (const capability of CAPABILITIES) {
      for (const example of capability.examples) {
        expect(/\d{4,}/.test(example)).toBe(false);
      }
    }
    expect(answer).not.toMatch(/счёт\s+\d/i);
  });

  it('не обещает отключённые возможности', () => {
    const answer = buildCapabilitiesAnswer({ reviewEnabled: false, newsEnabled: false });

    expect(answer).not.toContain('Разбор портфеля');
    expect(answer).not.toContain('Разбор счёта');
    expect(answer).not.toContain('Разбор бумаги');
    expect(answer).not.toContain('Новости рынка');
    expect(answer).toContain('Портфель и счета');
    expect(answer).toContain('Сейчас отключено: разбор портфеля, счёта и бумаги, сводка новостей');
    expect(availableCapabilities({ reviewEnabled: false })).toEqual(
      CAPABILITIES.filter((capability) => capability.requiresReview !== true),
    );
    expect(disabledCapabilitiesNote({})).toBeUndefined();
  });

  it('не обещает объяснение понятий при выключенной базе знаний', () => {
    const answer = buildCapabilitiesAnswer({ knowledgeEnabled: false });

    expect(answer).not.toContain('Объяснение инвестиционных понятий');
    expect(answer).toContain('Сейчас отключено: объяснение инвестиционных понятий');
    expect(availableCapabilities({ knowledgeEnabled: false }).map((item) => item.id)).not.toContain(
      'knowledge',
    );
    // При включённой базе возможность есть и подкреплена примером вопроса.
    expect(buildCapabilitiesAnswer()).toContain('что такое диверсификация?');
  });

  it('одинаково отвечает на разные формулировки', () => {
    expect(buildCapabilitiesAnswer()).toEqual(buildCapabilitiesAnswer());
  });
});
