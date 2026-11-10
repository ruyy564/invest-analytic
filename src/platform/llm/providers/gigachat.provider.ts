import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { GigaChat } from 'langchain-gigachat';
import type { AppConfig } from '../../config/configuration.js';
import type { LlmProvider, LlmRole } from '../llm-provider.interface.js';

export interface GigachatParams {
  credentials: string;
  scope: string;
  authUrl: string;
  model: string;
  /**
   * `false` — обычный HTTP-запрос вместо SSE-потока. У GigaChat поток иногда
   * приходит обрезанным («Unterminated string in JSON»), клиент считает это
   * ошибкой и повторяет запрос минутами; без streaming прогон отвечает сразу.
   */
  streaming: boolean;
  /** Транспортный таймаут запроса: дольше ждать бессмысленно. */
  timeout: number;
  /** Предел токенов ответа: классификатору хватает одного слова. */
  maxTokens: number;
  /**
   * Запрет потокового режима на уровне LangChain: Studio/LangGraph передают
   * streaming-callbacks, и без этого флага модель уходит в SSE даже при
   * `streaming: false`, а битый чанк подвешивает прогон.
   */
  disableStreaming: boolean;
}

/**
 * Пределы ответа по ролям: роутеру нужно одно слово, ответчику — отчёт.
 * Без `maxTokens` GigaChat-2-Max генерирует длинный текст, и вызов заметно
 * дольше, чем нужно агенту.
 *
 * 1 024 токена обрезали разбор бумаги на середине («Дивидендная политика:»),
 * поэтому ответчику даётся 2 048 — этого хватает на разбор с разделами.
 * Таймаут ответа в провайдере должен быть не меньше, чем ждёт узел
 * (`ANSWER_TIMEOUT_MS = 60 000`): иначе запрос рвётся транспортом.
 */
export const ROLE_LIMITS = {
  router: { maxTokens: 16, timeoutMs: 8_000 },
  answer: { maxTokens: 2_048, timeoutMs: 45_000 },
} as const;

/** Параметры GigaChat вынесены отдельно, чтобы их можно было проверить тестом. */
export const buildGigachatParams = (llm: AppConfig['llm'], role: LlmRole): GigachatParams => ({
  credentials: llm.gigachat.credentials ?? '',
  scope: llm.gigachat.scope,
  authUrl: llm.gigachat.authUrl,
  model: role === 'answer' ? llm.model : llm.routerModel,
  streaming: llm.gigachat.streaming,
  timeout: ROLE_LIMITS[role].timeoutMs,
  maxTokens: ROLE_LIMITS[role].maxTokens,
  disableStreaming: !llm.gigachat.streaming,
});

export class GigachatProvider implements LlmProvider {
  readonly id = 'gigachat' as const;

  constructor(private readonly llm: AppConfig['llm']) {}

  createChatModel(role: LlmRole): BaseChatModel {
    const model = new GigaChat(buildGigachatParams(this.llm, role));

    // Библиотека оборачивает каждый вызов в p-retry: битый SSE-чанк («Unterminated
    // string in JSON») повторяется с задержками, и ответ «висит» минутами.
    // Повторять запрос должен прогон, а не транспорт — отвечаем один раз.
    (
      model as unknown as {
        caller: {
          call: (fn: () => Promise<unknown>) => Promise<unknown>;
          callWithOptions: (o: unknown, fn: () => Promise<unknown>) => Promise<unknown>;
        };
      }
    ).caller = {
      call: (fn) => fn(),
      callWithOptions: (_options, fn) => fn(),
    };

    // LangGraph/Studio включают поток через callbacks, и тогда клиент идёт в SSE
    // мимо параметра `streaming`. Подменяем генератор одним обычным запросом:
    // для графа это просто «ещё один чанк», для нас — стабильный ответ.
    (
      model as unknown as {
        _streamResponseChunks: (
          messages: unknown,
          options: unknown,
        ) => AsyncGenerator<ChatGenerationChunk>;
      }
    )._streamResponseChunks = async function* (messages, options) {
      const self = this as unknown as {
        invocationParams: (options: unknown) => Record<string, unknown>;
        _generateNonStreaming: (
          messages: unknown,
          params: Record<string, unknown>,
          options: unknown,
        ) => Promise<{ generations: { message: unknown; text: string }[] }>;
      };
      const result = await self._generateNonStreaming(
        messages,
        { ...self.invocationParams(options), stream: false },
        options,
      );
      const [generation] = result.generations;
      if (generation) {
        yield new ChatGenerationChunk({
          message: generation.message as never,
          text: generation.text,
        });
      }
    };

    return model;
  }
}
