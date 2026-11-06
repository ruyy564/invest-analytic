import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTickerAliases, matchersFor } from '../../src/capabilities/news/news.aliases.js';

const aliasesFile = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'aliases-'));
  const file = join(dir, 'ticker-aliases.yaml');
  writeFileSync(file, content);
  return file;
};

describe('алиасы эмитентов', () => {
  it('читает файл «ТИКЕР: алиас, алиас» и пропускает комментарии', () => {
    const aliases = loadTickerAliases(
      aliasesFile('# комментарий\nSBER: Сбер, Сбербанк\n\nPLZL: Полюс\n'),
    );

    expect(aliases).toEqual({ SBER: ['Сбер', 'Сбербанк'], PLZL: ['Полюс'] });
  });

  it('склеивает повторяющиеся строки одного тикера', () => {
    const aliases = loadTickerAliases(aliasesFile('SBER: Сбер\nSBER: Сбербанк, Сбер\n'));

    expect(aliases.SBER).toEqual(['Сбер', 'Сбербанк']);
  });

  it('возвращает пустую карту, если файла нет', () => {
    expect(loadTickerAliases(join(tmpdir(), 'нет-такого-файла.yaml'))).toEqual({});
  });

  it('собирает подстроки: тикер, название из позиции и алиасы без дублей', () => {
    expect(matchersFor({ ticker: 'SBER', name: 'Сбербанк' }, { SBER: ['Сбер', 'Сбербанк'] })).toEqual([
      'SBER',
      'Сбербанк',
      'Сбер',
    ]);
    expect(matchersFor({ ticker: 'TSPX' }, {})).toEqual(['TSPX']);
  });

  it('в файле проекта есть алиасы для популярных бумаг', () => {
    const aliases = loadTickerAliases(
      join(import.meta.dirname, '..', '..', 'data', 'ticker-aliases.yaml'),
    );

    expect(aliases.SBER).toContain('Сбер');
    expect(aliases.LKOH).toContain('ЛУКОЙЛ');
    expect(aliases.MRKP).toContain('Россети Московский регион');
    expect(aliases.YDEX).toContain('Яндекс');
  });
});
