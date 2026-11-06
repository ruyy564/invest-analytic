import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalExpiredError } from '../../src/agent/approval.errors.js';
import { ApprovalFlowService } from '../../src/agent/approval-flow.service.js';
import {
  ApprovalPolicyService,
  matchesRule,
  validateApprovalRules,
} from '../../src/agent/approvals/approval-policy.service.js';
import { AppConfigService } from '../../src/config/app-config.service.js';
import { ConfigError } from '../../src/config/config.error.js';

const configStub = (
  approvals: Partial<{ ttlMinutes: number; unlisted: 'require' | 'allow'; file: string }> = {},
): AppConfigService =>
  ({
    value: { approvals: { ttlMinutes: 15, unlisted: 'require', ...approvals } },
  }) as unknown as AppConfigService;

const writeRulesFile = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'approvals-'));
  const file = join(dir, 'approvals.json');
  writeFileSync(file, content, 'utf8');
  return file;
};

describe('правила подтверждений', () => {
  it('берёт встроенный набор: счета без подтверждения, портфель с подтверждением', () => {
    const policy = new ApprovalPolicyService(configStub());

    expect(policy.requiresApproval('tinkoff__invest_list_accounts')).toBe(false);
    expect(policy.requiresApproval('tinkoff__invest_get_portfolio')).toBe(true);
    expect(policy.requiresApproval('tinkoff__invest_get_positions')).toBe(true);
  });

  it('для инструментов без правила применяет политику по умолчанию', () => {
    expect(new ApprovalPolicyService(configStub()).requiresApproval('custom__unknown')).toBe(true);
    expect(
      new ApprovalPolicyService(configStub({ unlisted: 'allow' })).requiresApproval('custom__unknown'),
    ).toBe(false);
  });

  it('фасады бумаг требуют подтверждения, публичные новости — нет', () => {
    const policy = new ApprovalPolicyService(configStub());

    // Любое чтение данных брокера — только с согласия пользователя.
    expect(policy.requiresApproval('instruments__prices')).toBe(true);
    expect(policy.requiresApproval('instruments__dividends')).toBe(true);
    // Публичный источник данных пользователя не читает.
    expect(policy.requiresApproval('news__search')).toBe(false);
  });

  it('сопоставляет правила по шаблону', () => {
    expect(matchesRule('tinkoff__invest_*', 'tinkoff__invest_get_portfolio')).toBe(true);
    expect(matchesRule('tinkoff__invest_*', 'news__invest_get_portfolio')).toBe(false);
    expect(matchesRule('tinkoff__invest_get_portfolio', 'tinkoff__invest_get_portfolio')).toBe(true);
  });

  it('запрещает дубликаты и торговые инструменты без подтверждения', () => {
    expect(() =>
      validateApprovalRules([
        { tool: 'a', label: 'A', question: 'Q', requiresApproval: true },
        { tool: 'a', label: 'A2', question: 'Q2', requiresApproval: true },
      ]),
    ).toThrow(/указано дважды/);

    expect(() =>
      validateApprovalRules([
        { tool: 'invest_create_order', label: 'Заявка', question: 'Q', requiresApproval: false },
      ]),
    ).toThrow(/торговый инструмент/);
  });

  it('загружает набор из APPROVALS_FILE и заменяет встроенный', () => {
    const file = writeRulesFile(
      JSON.stringify({
        unlisted: 'allow',
        rules: [
          { tool: 'news__search', label: 'Поиск новостей', question: 'Искать новости?', requiresApproval: true },
        ],
      }),
    );
    const policy = new ApprovalPolicyService(configStub({ file }));

    expect(policy.rulesSnapshot).toHaveLength(1);
    expect(policy.unlisted).toBe('allow');
    expect(policy.requiresApproval('tinkoff__invest_get_portfolio')).toBe(false);
    expect(policy.requiresApproval('news__search')).toBe(true);
  });

  it('падает на отсутствующем и некорректном файле правил', () => {
    expect(() => new ApprovalPolicyService(configStub({ file: join(tmpdir(), 'nope.json') }))).toThrow(
      /APPROVALS_FILE/,
    );

    const broken = writeRulesFile('{ not json');
    expect(() => new ApprovalPolicyService(configStub({ file: broken }))).toThrow(ConfigError);
  });

  it('проверяет, что правила ссылаются на известные инструменты', () => {
    const policy = new ApprovalPolicyService(configStub());

    expect(() => policy.assertKnownTools(['tinkoff__invest_list_accounts'])).toThrow(
      /отсутствует в каталоге MCP/,
    );
    // Полный каталог: все инструменты, на которые ссылаются правила (кроме локальной
    // сводки, которую собирает само приложение).
    const catalog = policy.rulesSnapshot
      .map((rule) => rule.tool)
      .filter((tool) => !tool.includes('*'));
    expect(() => policy.assertKnownTools(catalog)).not.toThrow();
  });
});

describe('жизненный цикл подтверждения', () => {
  it('считает срок ожидания и бросает доменную ошибку', () => {
    const flow = new ApprovalFlowService(configStub({ ttlMinutes: 15 }));
    const now = new Date('2026-10-29T12:00:00Z');

    expect(flow.isExpired('2026-10-29T11:50:00Z', now)).toBe(false);
    expect(flow.isExpired('2026-10-29T11:40:00Z', now)).toBe(true);
    expect(() => flow.assertNotExpired('2026-10-29T11:40:00Z', now)).toThrow(ApprovalExpiredError);
  });

  it('собирает payload с действиями и счётом', () => {
    const flow = new ApprovalFlowService(configStub());

    const payload = flow.buildPayload(
      [
        {
          rule: {
            tool: 'tinkoff__invest_get_portfolio',
            label: 'Состав и стоимость портфеля',
            question: 'Прочитать данные портфеля у брокера?',
            requiresApproval: true,
          },
          args: { accountId: 'acc-1' },
        },
      ],
      'acc-1',
    );

    expect(payload).toMatchObject({
      question: 'Прочитать данные портфеля у брокера?',
      actions: [
        {
          tool: 'tinkoff__invest_get_portfolio',
          label: 'Состав и стоимость портфеля',
          args: { accountId: 'acc-1' },
        },
      ],
      accountId: 'acc-1',
      limits: { approvalTtlMinutes: 15 },
    });
    // Срок согласия виден заранее: пользователь знает, сколько оно действует.
    expect(Date.parse(payload.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });
});
