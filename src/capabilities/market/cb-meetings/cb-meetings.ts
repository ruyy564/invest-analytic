import { readFileSync } from 'node:fs';
import { parseYaml } from '../../../shared/parsing/yaml.js';

/**
 * План заседаний ЦБ по ключевой ставке.
 *
 * Даты публикуются ЦБ заранее и меняются 1–2 раза в год, поэтому источник —
 * файл-данные (`data/cb-meetings.yaml`), а не HTML-парсинг календаря: парсинг
 * ломается от редизайна страницы, а расписание нужно всего на несколько строк.
 */

/** Одно заседание: дата решения и тип. */
export interface CbMeeting {
  /** Дата заседания, `YYYY-MM-DD`. */
  date: string;
  /** `опорное` или `предварительное` — как в плане ЦБ. */
  type?: string;
}

export interface CbMeetings {
  meetings: CbMeeting[];
  /** Дата, на которую актуален план: по ней видно, не устарел ли файл. */
  updatedAt?: string;
  source?: string;
}

export const EMPTY_CB_MEETINGS: CbMeetings = { meetings: [] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Строка-дата в виде `YYYY-MM-DD`; битая или несуществующая дата — `undefined`. */
const asDate = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim();
  if (!DATE_PATTERN.test(text)) {
    return undefined;
  }
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  // `2026-02-31` парсится в март: сверяем обратное преобразование.
  return new Date(parsed).toISOString().slice(0, 10) === text ? text : undefined;
};

/** Разбор файла плана: битые записи пропускаются, а не ломают календарь. */
export const parseCbMeetings = (raw: unknown): CbMeetings => {
  const root = asRecord(raw);
  if (!root) {
    return EMPTY_CB_MEETINGS;
  }
  const list = Array.isArray(root.meetings) ? root.meetings : [];
  const meetings: CbMeeting[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const date = asDate(record?.date);
    if (!date) {
      continue;
    }
    const type = typeof record?.type === 'string' ? record.type.trim() : '';
    meetings.push({ date, ...(type ? { type } : {}) });
  }
  // Порядок в файле не гарантирован: календарь всегда по возрастанию даты.
  meetings.sort((left, right) => left.date.localeCompare(right.date));
  return {
    meetings,
    ...(typeof root.updatedAt === 'string' ? { updatedAt: root.updatedAt } : {}),
    ...(typeof root.source === 'string' ? { source: root.source } : {}),
  };
};

const cache = new Map<string, CbMeetings>();

/** План из YAML-файла; отсутствие или поломка файла — пустой план, а не ошибка. */
export const loadCbMeetings = (path: string): CbMeetings => {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  let meetings = EMPTY_CB_MEETINGS;
  try {
    meetings = parseCbMeetings(parseYaml(readFileSync(path, 'utf8')));
  } catch {
    meetings = EMPTY_CB_MEETINGS;
  }
  cache.set(path, meetings);
  return meetings;
};

/** Дата в ISO-виде `YYYY-MM-DD` без времени. */
const dayOf = (now: Date): string => now.toISOString().slice(0, 10);

/** Будущие заседания по возрастанию даты: прошедшие в ответ не попадают. */
export const upcomingMeetings = (
  meetings: CbMeetings,
  now: Date = new Date(),
  limit = 2,
): CbMeeting[] => {
  const today = dayOf(now);
  return meetings.meetings.filter((meeting) => meeting.date >= today).slice(0, Math.max(1, limit));
};

/** Текст календаря: даты ближайших заседаний и дата актуальности плана. */
export const formatCbMeetings = (meetings: CbMeetings, now: Date = new Date()): string => {
  const upcoming = upcomingMeetings(meetings, now, 2);
  const updated = meetings.updatedAt ? ` (план на ${meetings.updatedAt})` : '';
  if (upcoming.length === 0) {
    const last = meetings.meetings.at(-1);
    return last
      ? `Ближайших заседаний ЦБ в плане нет: последнее было ${last.date}${updated}.`
      : `Плана заседаний ЦБ нет: дат в данных не найдено${updated}.`;
  }
  const list = upcoming
    .map((meeting) => `${meeting.date}${meeting.type ? ` (${meeting.type})` : ''}`)
    .join(', ');
  return `Заседания ЦБ по ключевой ставке: ${list}${updated}.`;
};
