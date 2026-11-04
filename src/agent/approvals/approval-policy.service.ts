import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { ConfigError } from '../../config/config.error.js';
import { isForbiddenTool } from '../../config/env.schema.js';
import { APPROVAL_RULES } from './approval-rules.js';
import {
  approvalRulesFileSchema,
  type ApprovalRule,
} from './approval-rules.schema.js';

/**
 * Инструменты, которые собирает само приложение, а не MCP-сервер:
 * сводка по счетам, динамика цены, тематические инструменты источников.
 */
export const LOCAL_TOOLS: readonly string[] = [
  'portfolio_all_accounts',
  'price_dynamics',
  'portfolio__snapshot',
  'portfolio__review',
  'security__brief',
  'market__price_dynamics',
  'market__news_digest',
  'market__tax_watch',
  'macro__key_rate',
];

export interface LoadedRules {
  rules: ApprovalRule[];
  unlisted?: 'require' | 'allow';
}

/** Читает правила из `APPROVALS_FILE` (JSON) или берёт встроенные. */
export const loadApprovalRules = (file: string | undefined): LoadedRules => {
  if (!file) {
    return { rules: APPROVAL_RULES };
  }

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError([
      `APPROVALS_FILE: не удалось прочитать ${file}: ${(error as Error).message}`,
    ]);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError([`APPROVALS_FILE: некорректный JSON в ${file}: ${(error as Error).message}`]);
  }

  const parsed = approvalRulesFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map(
        (issue) => `APPROVALS_FILE: ${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
      ),
    );
  }

  return { rules: parsed.data.rules, unlisted: parsed.data.unlisted };
};

/** Статические проверки набора правил: дубликаты и торговые действия без подтверждения. */
export const validateApprovalRules = (rules: ApprovalRule[]): void => {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.tool)) {
      issues.push(`правило "${rule.tool}" указано дважды`);
    }
    seen.add(rule.tool);

    if (!rule.requiresApproval && isForbiddenTool(rule.tool)) {
      issues.push(`торговый инструмент "${rule.tool}" не может быть без подтверждения`);
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues.map((issue) => `правила подтверждений: ${issue}`));
  }
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Сопоставление правила с инструментом: точное имя или шаблон с `*`. */
export const matchesRule = (pattern: string, tool: string): boolean => {
  if (!pattern.includes('*')) {
    return pattern === tool;
  }
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  return regex.test(tool);
};

/** Решает, нужно ли подтверждение для инструмента, и отдаёт правило для текста запроса. */
@Injectable()
export class ApprovalPolicyService {
  private readonly rules: ApprovalRule[];
  readonly unlisted: 'require' | 'allow';

  constructor(private readonly config: AppConfigService) {
    const loaded = loadApprovalRules(this.config.value.approvals.file);
    validateApprovalRules(loaded.rules);
    this.rules = loaded.rules;
    this.unlisted = loaded.unlisted ?? this.config.value.approvals.unlisted;
  }

  ruleFor(toolName: string): ApprovalRule | undefined {
    return this.rules.find((rule) => matchesRule(rule.tool, toolName));
  }

  requiresApproval(toolName: string): boolean {
    const rule = this.ruleFor(toolName);
    return rule ? rule.requiresApproval : this.unlisted === 'require';
  }

  /**
   * Правила не должны ссылаться на инструменты, которых нет в каталоге MCP.
   * Локальные инструменты приложения (`portfolio_all_accounts`) в каталоге
   * отсутствуют по определению — их собирает реестр, а не сервер.
   */
  assertKnownTools(catalog: readonly string[]): void {
    const known = new Set<string>([...catalog, ...LOCAL_TOOLS]);
    const unknown = this.rules.filter((rule) => !rule.tool.includes('*') && !known.has(rule.tool));
    if (unknown.length > 0) {
      throw new ConfigError(
        unknown.map(
          (rule) => `правила подтверждений: инструмент "${rule.tool}" отсутствует в каталоге MCP`,
        ),
      );
    }
  }

  get rulesSnapshot(): readonly ApprovalRule[] {
    return this.rules;
  }
}
