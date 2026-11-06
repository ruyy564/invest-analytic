import { HttpGateway } from '../../src/platform/http/index.js';

describe('шлюз внешних запросов', () => {
  it('переходит на резервный адрес после ошибки', async () => {
    const calls: string[] = [];
    const gateway = new HttpGateway(
      async (url) => {
        calls.push(url);
        if (url === 'primary') {
          throw new Error('HTTP 429');
        }
        return 'ok';
      },
      { retries: 0 },
    );

    await expect(gateway.get(['primary', 'fallback'])).resolves.toEqual({
      text: 'ok',
      url: 'fallback',
    });
    expect(calls).toEqual(['primary', 'fallback']);
  });

  it('кэширует успешный ответ и не ходит в сеть повторно', async () => {
    let calls = 0;
    const gateway = new HttpGateway(async () => {
      calls += 1;
      return 'body';
    });

    await gateway.get(['feed']);
    await gateway.get(['feed']);

    expect(calls).toBe(1);
  });

  it('не повторяет запрос после ошибки в пределах срока', async () => {
    let calls = 0;
    let now = 0;
    const gateway = new HttpGateway(
      async () => {
        calls += 1;
        throw new Error('ECONNREFUSED');
      },
      { retries: 0, failureTtlMs: 1_000, now: () => now },
    );

    await expect(gateway.get(['feed'])).rejects.toThrow('ECONNREFUSED');
    now = 500;
    await expect(gateway.get(['feed'])).rejects.toThrow('ECONNREFUSED');
    expect(calls).toBe(1);

    // После истечения срока ошибка не держит источник вечно.
    now = 2_000;
    await expect(gateway.get(['feed'])).rejects.toThrow('ECONNREFUSED');
    expect(calls).toBe(2);
  });

  it('прерывает зависший запрос по таймауту', async () => {
    const gateway = new HttpGateway(() => new Promise<string>(() => undefined), {
      timeoutMs: 10,
      retries: 0,
    });

    await expect(gateway.get(['slow'])).rejects.toThrow('таймаут');
  });

  it('ограничивает число одновременных запросов', async () => {
    let active = 0;
    let peak = 0;
    const gateway = new HttpGateway(
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return 'ok';
      },
      { concurrency: 2 },
    );

    await Promise.all(
      ['a', 'b', 'c', 'd'].map((url) => gateway.get([url])),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });
});
