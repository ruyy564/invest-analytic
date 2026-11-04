#!/usr/bin/env node
// Обновляет data/key-rate-seed.json через официальный SOAP-метод ЦБ KeyRateXML.
// Использование: node scripts/fetch-key-rate.mjs [лет]
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'data', 'key-rate-seed.json');
const years = Number(process.argv[2] ?? 3);
const soapUrl = process.env.KEY_RATE_SOAP_URL ?? 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';

const now = new Date();
const to = now.toISOString().slice(0, 10);
const from = new Date(now.getTime() - years * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

const envelope =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  '<KeyRateXML xmlns="http://web.cbr.ru/">' +
  `<fromDate>${from}</fromDate><ToDate>${to}</ToDate>` +
  '</KeyRateXML></soap:Body></soap:Envelope>';

const response = await fetch(soapUrl, {
  method: 'POST',
  headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '"http://web.cbr.ru/KeyRateXML"' },
  body: envelope,
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  console.error(`ЦБ ответил HTTP ${response.status}`);
  process.exit(1);
}

const xml = await response.text();
const points = [];
const push = (date, rate) => {
  const value = Number.parseFloat(String(rate).replace(',', '.'));
  if (!Number.isNaN(value) && value > 0) {
    points.push({ date: String(date).slice(0, 10), rate: value });
  }
};

for (const match of xml.matchAll(/<DT>([^<]+)<\/DT>\s*<Rate>([^<]+)<\/Rate>/gi)) {
  push(match[1], match[2]);
}
if (points.length === 0) {
  for (const match of xml.matchAll(/<KR[^>]*\bDATE="([^"]+)"[^>]*\bRATE="([^"]+)"/gi)) {
    push(match[1], match[2]);
  }
}
if (points.length === 0) {
  console.error('Не удалось разобрать ответ ЦБ: ни DT/Rate, ни DATE/RATE не найдены');
  process.exit(1);
}

// Оставляем только моменты изменения ставки — именно они нужны отчёту.
const ascending = points.sort((left, right) => left.date.localeCompare(right.date));
const changes = [];
for (const point of ascending) {
  if (!changes.length || changes.at(-1).rate !== point.rate) {
    changes.push(point);
  }
}

const payload = {
  comment: 'История решений по ключевой ставке ЦБ. Обновляется: node scripts/fetch-key-rate.mjs',
  updatedAt: new Date().toISOString(),
  source: `${soapUrl} (KeyRateXML)`,
  points: changes,
};

writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Записано ${changes.length} решений за ${from}..${to} → ${target}`);
