import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { LlmRole } from '../../src/llm/llm-provider.interface.js';

/** Один шаг сценария: текст ответа или готовое сообщение с `tool_calls`. */
export type ScriptedStep = string | AIMessage;

/** Последнее сообщение пользователя в диалоге. */
export const lastHumanText = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message._getType() === 'human') {
      return typeof message.content === 'string' ? message.content : '';
    }
  }
  return '';
};

/**
 * Детерминированная модель для тестов: отдаёт заранее заданные ответы
 * по очереди, последний шаг повторяется. Сеть и ключи не нужны.
 */
export class ScriptedChatModel extends BaseChatModel {
  private readonly steps: ScriptedStep[];

  constructor(steps: ScriptedStep[]) {
    super({});
    this.steps = [...steps];
  }

  _llmType(): string {
    return 'scripted';
  }

  /** Фейковая модель «принимает» инструменты, возвращая себя. */
  bindTools(..._args: unknown[]): this {
    return this;
  }

  protected async _generate(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const step = this.steps.length > 1 ? (this.steps.shift() as ScriptedStep) : this.steps[0];
    const message = typeof step === 'string' ? new AIMessage(step) : step;
    return {
      generations: [{ text: typeof message.content === 'string' ? message.content : '', message }],
    };
  }
}

/** Тестовый провайдер: подключается в реестр вместо реального. */
export class FakeLlmProvider {
  readonly id = 'fake';

  constructor(private readonly steps: ScriptedStep[] = ['ok']) {}

  createChatModel(_role: LlmRole): ScriptedChatModel {
    return new ScriptedChatModel(this.steps);
  }
}
