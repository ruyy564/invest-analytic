import { Module } from '@nestjs/common';
import { KnowledgeRepository } from './knowledge.repository.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * Модуль базы знаний: чтение каталога тем и правила отбора.
 * Экспортирует только сервис — остальным не нужно знать про файлы.
 */
@Module({
  providers: [KnowledgeRepository, KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
