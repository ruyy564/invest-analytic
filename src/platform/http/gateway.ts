/** Ответ шлюза: текст и адрес, с которого он реально получен. */
export interface GatewayResponse {
  text: string;
  url: string;
}

export interface HttpGatewayOptions {
  timeoutMs?: number;
  /** Сколько раз пробовать резервные адреса и повторы. */
  retries?: number;
  retryDelaysMs?: readonly number[];
  /** Сколько запросов выполнять одновременно. */
  concurrency?: number;
  cacheTtlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
}

const DEFAULTS = {
  timeoutMs: 8_000,
  retries: 2,
  retryDelaysMs: [300, 900] as const,
  concurrency: 4,
  cacheTtlMs: 300_000,
  failureTtlMs: 5_000,
};

/**
 * Шлюз внешних текстовых запросов: таймаут, ограничение параллельности, повторы,
 * резервные адреса и кэш. Источники не занимаются этим сами.
 */
export class HttpGateway {
  private readonly cache = new Map<string, { at: number; response: GatewayResponse }>();
  private readonly failures = new Map<string, { at: number; error: Error }>();
  private readonly pending = new Map<string, Promise<GatewayResponse>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly options: Required<Omit<HttpGatewayOptions, 'now'>> & { now: () => number };

  constructor(
    private readonly fetchText: (url: string) => Promise<string>,
    options: HttpGatewayOptions = {},
  ) {
    this.options = {
      ...DEFAULTS,
      ...options,
      retryDelaysMs: options.retryDelaysMs ?? DEFAULTS.retryDelaysMs,
      now: options.now ?? (() => Date.now()),
    };
  }

  /** Читает первый доступный адрес: кэш → сеть с повторами → резервный адрес. */
  async get(urls: readonly string[]): Promise<GatewayResponse> {
    const list = urls.filter((url) => typeof url === 'string' && url.length > 0);
    const key = list[0];
    if (!key) {
      throw new Error('не задан адрес источника');
    }

    const cached = this.cache.get(key);
    if (cached && this.options.now() - cached.at < this.options.cacheTtlMs) {
      return cached.response;
    }

    const failure = this.failures.get(key);
    if (failure && this.options.now() - failure.at < this.options.failureTtlMs) {
      throw failure.error;
    }

    const running = this.pending.get(key);
    if (running) {
      return running;
    }

    const request = this.load(list).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  /** Сброс кэша: нужен тестам и ручному обновлению. */
  clear(): void {
    this.cache.clear();
    this.failures.clear();
  }

  private async load(urls: readonly string[]): Promise<GatewayResponse> {
    const key = urls[0];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      for (const url of urls) {
        try {
          const text = await this.slot(() => this.withTimeout(url));
          const response = { text, url };
          this.cache.set(key, { at: this.options.now(), response });
          this.failures.delete(key);
          return response;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      const delay = this.options.retryDelaysMs[attempt];
      if (delay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const failure = lastError ?? new Error('источник недоступен');
    this.failures.set(key, { at: this.options.now(), error: failure });
    throw failure;
  }

  private async withTimeout(url: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.fetchText(url),
        new Promise<string>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`таймаут ${this.options.timeoutMs} мс`)),
            this.options.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /** Ограничитель одновременных запросов. */
  private async slot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
