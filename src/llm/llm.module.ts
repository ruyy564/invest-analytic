import { Module } from '@nestjs/common';

/** Токены моделей: узлы графа получают модель только через DI, не создают её сами. */
export const LLM_ANSWER_MODEL = Symbol('LLM_ANSWER_MODEL');
export const LLM_ROUTER_MODEL = Symbol('LLM_ROUTER_MODEL');

/**
 * Реестр LLM-провайдеров подключается в следующей группе задач:
 * провайдеры и фабрики моделей регистрируются здесь.
 */
@Module({})
export class LlmModule {}
