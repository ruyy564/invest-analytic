import {
  formatCbMeetings,
  parseCbMeetings,
  upcomingMeetings,
} from '../../src/capabilities/market/cb-meetings/cb-meetings.js';
import { createCbMeetingsTool } from '../../src/capabilities/market/cb-meetings/cb-meetings.tool.js';

const NOW = new Date('2026-11-07T10:00:00.000Z');

const plan = (meetings: unknown[], updatedAt = '2026-11-01') =>
  parseCbMeetings({ updatedAt, source: 'https://www.cbr.ru/calendar/', meetings });

describe('план заседаний ЦБ', () => {
  it('оставляет только будущие даты и сортирует их', () => {
    const parsed = plan([
      { date: '2027-02-12', type: 'предварительное' },
      { date: '2026-09-11', type: 'опорное' },
      { date: '2026-12-18', type: 'опорное' },
    ]);

    expect(parsed.meetings.map((meeting) => meeting.date)).toEqual([
      '2026-09-11',
      '2026-12-18',
      '2027-02-12',
    ]);
    expect(upcomingMeetings(parsed, NOW).map((meeting) => meeting.date)).toEqual([
      '2026-12-18',
      '2027-02-12',
    ]);
    expect(upcomingMeetings(parsed, NOW, 1)).toHaveLength(1);
  });

  it('пропускает битые строки, а не ломает календарь', () => {
    const parsed = plan([
      { date: '2026-02-31' },
      { date: 'заседание' },
      { type: 'опорное' },
      'строка вместо объекта',
      { date: '2026-12-18', type: 'опорное' },
    ]);

    expect(parsed.meetings).toEqual([{ date: '2026-12-18', type: 'опорное' }]);
  });

  it('на пустом файле отдаёт пустой план без ошибки', () => {
    expect(parseCbMeetings(null)).toEqual({ meetings: [] });
    expect(parseCbMeetings({})).toEqual({ meetings: [] });
    expect(parseCbMeetings({ meetings: [] }).meetings).toEqual([]);
  });

  it('пишет даты и дату актуальности плана', () => {
    const text = formatCbMeetings(
      plan([
        { date: '2026-10-23', type: 'опорное' },
        { date: '2026-12-18', type: 'опорное' },
      ]),
      NOW,
    );

    expect(text).toBe(
      'Заседания ЦБ по ключевой ставке: 2026-12-18 (опорное) (план на 2026-11-01).',
    );
  });

  it('без будущих дат говорит об этом прямо', () => {
    const onlyPast = formatCbMeetings(plan([{ date: '2026-09-11', type: 'опорное' }]), NOW);

    expect(onlyPast).toBe(
      'Ближайших заседаний ЦБ в плане нет: последнее было 2026-09-11 (план на 2026-11-01).',
    );
    expect(formatCbMeetings(parseCbMeetings(null), NOW)).toContain('дат в данных не найдено');
  });

  it('инструмент возвращает календарь из файла', async () => {
    const tool = createCbMeetingsTool({
      file: 'data/cb-meetings.yaml',
      now: () => NOW,
    });

    const answer = String(await tool.invoke({}));

    expect(answer).toContain('Заседания ЦБ по ключевой ставке:');
    expect(answer).toContain('(план на 2026-11-01)');
  });

  it('инструмент без файла не падает', async () => {
    const tool = createCbMeetingsTool({ file: 'data/нет-такого-файла.yaml', now: () => NOW });

    expect(String(await tool.invoke({}))).toContain('дат в данных не найдено');
  });
});
