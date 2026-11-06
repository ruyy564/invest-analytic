import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import {
  CONCLUSION_RUBRIC,
  judgeAnswer,
  loadEvalCases,
  parseJudgeResponse,
  recordedRunOf,
  runCase,
  summarizeEval,
  type EvalCase,
} from '../../src/eval/index.js';
import { ScriptedChatModel } from '../fixtures/fake-chat-model.js';

const CASES = 'test/eval/cases/dialogues.json';

const caseOf = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: 'case-1',
  question: 'вопрос',
  expectedTools: [],
  forbiddenTools: [],
  trials: 1,
  tags: [],
  ...overrides,
});

describe('схема кейсов оценки', () => {
  it('читает корзину диалогов и подставляет значения по умолчанию', () => {
    const cases = loadEvalCases(CASES);

    expect(cases.length).toBeGreaterThanOrEqual(10);
    const sber = cases.find((item) => item.id === 'buy-sber');
    expect(sber?.scope).toBe('instrument');
    expect(sber?.target).toBe('SBER');
    expect(sber?.trials).toBe(1);
    expect(sber?.answer?.mustContain.length).toBeGreaterThan(0);
  });
});

describe('грейдеры ответа', () => {
  it('проверяет обязательные и запрещённые фрагменты', () => {
    const testCase = caseOf({
      answer: { mustContain: ['цена'], mustNotContain: ['Состав портфеля'] },
    });

    const ok = runCase(testCase, [{ transcript: 'цена: 100 RUB' }]);
    const failed = runCase(testCase, [{ transcript: 'Состав портфеля' }]);

    expect(ok.runs[0].passed).toBe(true);
    expect(failed.runs[0].passed).toBe(false);
    expect(failed.runs[0].graders.some((grader) => !grader.passed)).toBe(true);
  });

  it('считает отказ модели провалом', () => {
    const testCase = caseOf();
    const result = runCase(testCase, [
      { transcript: 'Как и любая языковая модель, я не обладаю собственным мнением.' },
    ]);

    expect(result.runs[0].passed).toBe(false);
    expect(result.runs[0].graders.map((grader) => grader.grader)).toContain('no-refusal');
  });

  it('проверяет обязательные и запрещённые инструменты', () => {
    const testCase = caseOf({
      expectedTools: ['news__search'],
      forbiddenTools: ['portfolio__snapshot'],
    });

    const ok = runCase(testCase, [{ transcript: 'ответ', toolsUsed: ['news__search'] }]);
    const failed = runCase(testCase, [
      { transcript: 'ответ', toolsUsed: ['news__search', 'portfolio__snapshot'] },
    ]);

    expect(ok.runs[0].passed).toBe(true);
    expect(failed.runs[0].passed).toBe(false);
  });
});

describe('несколько прогонов и агрегаты', () => {
  it('различает pass@k и pass^k', () => {
    const testCase = caseOf({ answer: { mustContain: ['цена'], mustNotContain: [] } });
    const unstable = runCase(testCase, [
      { transcript: 'цена: 100' },
      { transcript: 'без нужного фрагмента' },
      { transcript: 'цена: 101' },
    ]);

    const summary = summarizeEval([unstable]);

    expect(summary.passAtK).toBe(1);
    expect(summary.passPowerK).toBe(0);
    expect(summary.trials).toBe(3);
  });

  it('считает метрики по тегам и перечисляет провалы', () => {
    const ok = runCase(caseOf({ id: 'ok', tags: ['required'], answer: { mustContain: [], mustNotContain: [] } }), [
      { transcript: 'ответ' },
    ]);
    const bad = runCase(caseOf({ id: 'bad', tags: ['required'], answer: { mustContain: ['цена'], mustNotContain: [] } }), [
      { transcript: 'ответ' },
    ]);

    const summary = summarizeEval([ok, bad]);

    expect(summary.byTag.required.cases).toBe(2);
    expect(summary.byTag.required.passAtK).toBe(0.5);
    expect(summary.failed[0].id).toBe('bad');
  });
});

describe('записанные прогоны', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'invest-transcripts-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('берёт транскрипт из файла кейса или из каталога', () => {
    writeFileSync(join(dir, 'from-file.txt'), 'ответ из файла', 'utf8');

    expect(recordedRunOf(caseOf({ transcript: 'в кейсе' }), dir)?.transcript).toBe('в кейсе');
    expect(recordedRunOf(caseOf({ id: 'from-file' }), dir)?.transcript).toBe('ответ из файла');
    expect(recordedRunOf(caseOf({ id: 'missing' }), dir)).toBeUndefined();
  });
});

describe('судья по рубрике', () => {
  it('разбирает оценку из ответа модели', () => {
    expect(parseJudgeResponse('{"score": 4, "reason": "факты на месте"}')).toEqual({
      score: 4,
      reason: 'факты на месте',
    });
    expect(parseJudgeResponse('без json')).toEqual({ reason: 'не удалось разобрать оценку' });
  });

  it('возвращает версию рубрики вместе с оценкой', async () => {
    const model = new ScriptedChatModel([new AIMessage('{"score": 5, "reason": "полно"}')]);

    const result = await judgeAnswer({
      model,
      rubric: CONCLUSION_RUBRIC,
      question: 'стоит ли покупать Сбер',
      answer: 'разбор',
    });

    expect(result).toMatchObject({
      score: 5,
      rubricId: 'conclusion',
      rubricVersion: 1,
      reason: 'полно',
    });
  });
});
