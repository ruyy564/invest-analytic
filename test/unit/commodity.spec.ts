import {
  cbrMetalsUrl,
  createCbrCommoditySource,
  parseMetalsXml,
} from '../../src/commodities/commodity.cbr.js';
import { metalForTicker, metalQuoteOf } from '../../src/commodities/commodity.links.js';
import { collectCommodities, formatCommodities } from '../../src/tools/commodity/commodity.service.js';

const XML = `<?xml version="1.0" encoding="windows-1251"?>
<Metall FromDate="20261101" ToDate="20261105" name="Precious metals quotations">
<Record Date="02.11.2026" Code="1"><Buy>10000,10</Buy><Sell>10000,10</Sell></Record>
<Record Date="03.11.2026" Code="1"><Buy>10187,57</Buy><Sell>10187,57</Sell></Record>
<Record Date="03.11.2026" Code="2"><Buy>130,43</Buy><Sell>130,43</Sell></Record>
<Record Date="03.11.2026" Code="4"><Buy>3714,86</Buy><Sell>3714,86</Sell></Record>
</Metall>`;

describe('commodities', () => {
  it('строит URL ЦБ с датами ДД/ММ/ГГГГ', () => {
    const url = cbrMetalsUrl(new Date('2026-10-29T00:00:00Z'), new Date('2026-11-05T00:00:00Z'));

    expect(url).toContain('date_req1=29/10/2026');
    expect(url).toContain('date_req2=05/11/2026');
  });

  it('разбирает XML ЦБ и оставляет последнюю дату', () => {
    const quotes = parseMetalsXml(XML);

    expect(quotes).toHaveLength(3);
    expect(quotes.find((quote) => quote.metal === 'gold')?.price).toBeCloseTo(10187.57);
    expect(quotes.every((quote) => quote.date === '03.11.2026')).toBe(true);
  });

  it('не падает на пустом ответе', () => {
    expect(parseMetalsXml('<Metall></Metall>')).toEqual([]);
  });

  it('источник кэширует снимок между вызовами', async () => {
    let calls = 0;
    const source = createCbrCommoditySource({
      now: () => new Date('2026-11-05T12:00:00Z'),
      fetchXml: async () => {
        calls += 1;
        return XML;
      },
    });

    const first = await source.read();
    const second = await source.read();

    expect(first?.origin).toBe('live');
    expect(second?.origin).toBe('cache');
    expect(calls).toBe(1);
  });

  it('находит металл бумаги и разбирает строку тула', () => {
    expect(metalForTicker('plzl')).toBe('gold');
    expect(metalForTicker('SBER')).toBeUndefined();

    const quote = metalQuoteOf('Учётные цены драгметаллов ЦБ на 03.11.2026 (RUB за грамм):\n• золото: 10 187,57 ₽/г (03.11.2026)', 'gold');
    expect(quote?.price).toBeCloseTo(10187.57);
    expect(quote?.date).toBe('03.11.2026');
  });

  it('без источника сообщает причину, а не пустоту', async () => {
    const result = await collectCommodities(undefined);

    expect(formatCommodities(result)).toContain('Цены металлов недоступны');
  });

  it('строка ответа тула разбирается обратно в котировку', async () => {
    const source = createCbrCommoditySource({
      now: () => new Date('2026-11-05T12:00:00Z'),
      fetchXml: async () => XML,
    });
    const text = formatCommodities(await collectCommodities(source));

    // Формат чисел ru-RU (пробел-разделитель, запятая) должен читаться тем же
    // парсером, что и в разборе бумаги, иначе строка «сырьё» не появится.
    expect(metalQuoteOf(text, 'gold')?.price).toBeCloseTo(10187.57);
  });
});
