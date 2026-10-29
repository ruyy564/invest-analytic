import { Module } from '@nestjs/common';
import { LlmRegistry } from './llm-registry.js';

/** Токены моделей: узлы графа получают модель только через DI, не создают её сами. */
export const LLM_ANSWER_MODEL = Symbol('LLM_ANSWER_MODEL');
export const LLM_ROUTER_MODEL = Symbol('LLM_ROUTER_MODEL');

@Module({
  providers: [
    LlmRegistry,
    {
      provide: LLM_ANSWER_MODEL,
      useFactory: (registry: LlmRegistry) => registry.createChatModel('answer'),
      inject: [LlmRegistry],
    },
    {
      provide: LLM_ROUTER_MODEL,
      useFactory: (registry: LlmRegistry) => registry.createChatModel('router'),
      inject: [LlmRegistry],
    },
  ],
  exports: [LlmRegistry, LLM_ANSWER_MODEL, LLM_ROUTER_MODEL],
})
export class LlmModule {}

