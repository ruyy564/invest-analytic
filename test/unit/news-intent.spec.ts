import { heuristicNewsIntent, parseIntentText } from '../../src/agent/prompts/classifier.prompt.js';

describe('новостной интент', () => {
  it('узнаёт вопросы про новости рынка', () => {
    expect(heuristicNewsIntent('какие последние новости в мире инвестиций?')).toBe(true);
    expect(heuristicNewsIntent('что нового на рынке за неделю')).toBe(true);
    expect(heuristicNewsIntent('новости инвестиций за месяц')).toBe(true);
  });

  it('не перехватывает новости по бумаге', () => {
    expect(heuristicNewsIntent('новости по SBER', 'instrument')).toBe(false);
    expect(heuristicNewsIntent('какие новости по Сберу', 'instrument')).toBe(false);
  });

  it('не перехватывает портфельные вопросы', () => {
    expect(heuristicNewsIntent('какие новости по моему портфелю?')).toBe(false);
    expect(heuristicNewsIntent('что нового на рынке и что делать с портфелем')).toBe(false);
  });

  it('не считает новостью вопрос о погоде', () => {
    expect(heuristicNewsIntent('какая погода в Москве?')).toBe(false);
  });

  it('разбирает метку market_news из текста модели', () => {
    expect(parseIntentText('market_news')).toEqual({ intent: 'market_news' });
    expect(parseIntentText('это новости рынка')).toEqual({ intent: 'market_news' });
    expect(parseIntentText('portfolio_review')).toEqual({ intent: 'portfolio_review' });
  });
});
