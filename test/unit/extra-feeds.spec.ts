import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExtraFeeds } from '../../src/capabilities/news/sources/extra.js';

const fileOf = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
  const file = join(dir, 'news-sources.yaml');
  writeFileSync(file, content);
  return file;
};

describe('дополнительные ленты', () => {
  it('читает список источников из YAML', () => {
    const feeds = loadExtraFeeds(
      fileOf('- id: cbr\n  url: https://www.cbr.ru/rss/eventrss\n  format: rss\n  topics: [news, macro]\n'),
    );

    expect(feeds).toEqual([
      {
        id: 'cbr',
        url: 'https://www.cbr.ru/rss/eventrss',
        format: 'rss',
        topics: ['news', 'macro'],
      },
    ]);
  });

  it('пропускает записи без адреса, файл без списка и отсутствующий файл', () => {
    expect(loadExtraFeeds(fileOf('- id: broken\n  url: ""\n'))).toEqual([]);
    expect(loadExtraFeeds(fileOf('# только комментарий\n'))).toEqual([]);
    expect(loadExtraFeeds(undefined)).toEqual([]);
    expect(loadExtraFeeds(join(tmpdir(), 'нет-такого-файла.yaml'))).toEqual([]);
  });

  it('подставляет формат и темы по умолчанию', () => {
    const feeds = loadExtraFeeds(fileOf('- id: extra\n  url: https://example.com/rss\n'));

    expect(feeds[0]).toMatchObject({ id: 'extra', format: 'rss', topics: ['news'] });
  });
});
