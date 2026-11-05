import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AppConfigService } from '../config/app-config.service.js';
import { parseYaml } from '../report/yaml.js';
import { EMPTY_KNOWLEDGE, KnowledgeFileSchema, type KnowledgeData, type KnowledgeTopic } from './knowledge.types.js';

/**
 * Чтение каталога тем с диска. Единственное место модуля, которое знает про файлы;
 * сервис и потребители работают с уже загруженными данными.
 */
@Injectable()
export class KnowledgeRepository {
  private readonly logger = new Logger(KnowledgeRepository.name);
  private cache?: KnowledgeData;

  constructor(private readonly config: AppConfigService) {}

  /** Источники из конфигурации: каталог тем и необязательный дополнительный файл. */
  private get sources(): string[] {
    const run = this.config.value.run;
    return [run.knowledgeDir, ...(run.knowledgeFile ? [run.knowledgeFile] : [])];
  }

  /** База знаний: читается один раз, при ошибке — пустая (сервис работает как раньше). */
  load(): KnowledgeData {
    if (this.cache) {
      return this.cache;
    }
    this.cache = this.read(this.sources);
    return this.cache;
  }

  /** Перечитать после правки файлов (например, в тестах). */
  reload(): KnowledgeData {
    this.cache = undefined;
    return this.load();
  }

  /** Файлы-темы: каталог разворачивается в список YAML, файл остаётся файлом. */
  files(source: string): string[] {
    try {
      if (!statSync(source).isDirectory()) {
        return [source];
      }
      return readdirSync(source)
        .filter((name) => ['.yaml', '.yml'].includes(extname(name).toLowerCase()))
        .sort()
        .map((name) => join(source, name));
    } catch (error) {
      // Каталога нет — это не ошибка: база знаний необязательна.
      this.logger.warn(`Источник знаний недоступен (${source}): ${this.reasonOf(error)}`);
      return [];
    }
  }

  private read(sources: readonly string[]): KnowledgeData {
    const files = sources.flatMap((source) => this.files(source));
    if (files.length === 0) {
      return EMPTY_KNOWLEDGE;
    }

    const topics: KnowledgeTopic[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const parsed = this.parse(file);
      if (!parsed) {
        continue;
      }
      for (const topic of parsed.topics) {
        if (seen.has(topic.id)) {
          this.logger.warn(`Тема ${topic.id} уже загружена, файл ${file} пропущен`);
          continue;
        }
        seen.add(topic.id);
        topics.push(topic);
      }
    }

    return { version: 1, topics };
  }

  /** Один файл: битый не ломает остальные, причина попадает в лог. */
  private parse(file: string): KnowledgeData | undefined {
    try {
      const result = KnowledgeFileSchema.safeParse(parseYaml(readFileSync(file, 'utf8')) ?? {});
      if (result.success) {
        return result.data;
      }
      const issues = result.error.issues.map((issue) => issue.message).join('; ');
      this.logger.warn(`Файл темы пропущен (${file}): ${issues}`);
    } catch (error) {
      this.logger.warn(`Файл темы пропущен (${file}): ${this.reasonOf(error)}`);
    }
    return undefined;
  }

  private reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
