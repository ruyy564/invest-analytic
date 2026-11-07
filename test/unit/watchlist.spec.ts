import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWatchlist } from '../../src/capabilities/news/index.js';

const fileOf = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'watchlist-'));
  const file = join(dir, 'watchlist.yaml');
  writeFileSync(file, content);
  return file;
};

describe('список бумаг для фона', () => {
  it('читает список тикеров', () => {
    expect(loadWatchlist(fileOf('- LKOH\n- sber\n- GAZP\n'))).toEqual(['LKOH', 'SBER', 'GAZP']);
  });

  it('читает отображение `tickers:` и убирает мусор', () => {
    expect(loadWatchlist(fileOf('tickers: [LKOH, не тикер, YDEX]\n'))).toEqual(['LKOH', 'YDEX']);
  });

  it('без файла и без списка возвращает пусто', () => {
    expect(loadWatchlist(undefined)).toEqual([]);
    expect(loadWatchlist(join(tmpdir(), 'нет-такого-файла.yaml'))).toEqual([]);
    expect(loadWatchlist(fileOf('# только комментарий\n'))).toEqual([]);
  });

  it('ограничивает число бумаг', () => {
    expect(loadWatchlist(fileOf('- LKOH\n- SBER\n- GAZP\n'), 2)).toEqual(['LKOH', 'SBER']);
  });
});
