import { clipToWords, createArticleReader, extractArticleText } from '../../src/capabilities/news/sources/article.js';

const PAGE = `<!doctype html><html><head><style>.a{color:red}</style><script>var x=1;</script></head>
<body><nav><a href="/">Главная</a></nav>
<article><h1>Заголовок</h1>
<p>Лукойл вырос на фоне дорожающей нефти: Brent поднялась выше 113 долларов за баррель.</p>
<p>Аналитики указывают на ожидания высоких дивидендов и продажу зарубежных активов.</p>
<p>Дополнительным фактором стала отчётность: выручка выросла на восемь процентов за полугодие.</p>
</article><footer>© 2026</footer></body></html>`;

describe('текст статьи', () => {
  it('берёт абзацы статьи без скриптов и навигации', () => {
    const text = extractArticleText(PAGE);

    expect(text).toContain('Brent поднялась выше 113 долларов');
    expect(text).toContain('ожидания высоких дивидендов');
    expect(text).not.toContain('<');
    expect(text).not.toContain('var x=1');
    expect(text).not.toContain('Главная');
  });

  it('без блока article берёт абзацы страницы', () => {
    const text = extractArticleText(
      '<div><p>Коротко</p><p>Достаточно длинный абзац текста для проверки разбора страницы.</p></div>',
    );

    expect(text).toContain('Достаточно длинный абзац');
  });

  it('обрезает по границе слова', () => {
    const text = clipToWords('один два три четыре пять', 10);

    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toContain('четыр');
  });

  it('читает статью по ссылке и отдаёт текст', async () => {
    const read = createArticleReader({ fetchText: async () => PAGE });

    expect(await read('https://example.com/news/1')).toContain('Brent');
  });

  it('не отдаёт заглушку и не падает на ошибке сети', async () => {
    const short = createArticleReader({
      fetchText: async () => '<html><body>Прочитайте на сайте</body></html>',
    });
    expect(await short('https://example.com/news/2')).toBeUndefined();

    const broken = createArticleReader({
      fetchText: async () => {
        throw new Error('HTTP 403');
      },
    });
    expect(await broken('https://example.com/news/3')).toBeUndefined();
    expect(await broken(undefined)).toBeUndefined();
  });
});
