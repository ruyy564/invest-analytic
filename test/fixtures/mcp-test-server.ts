import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface TestMcpServer {
  url: string;
  close: () => Promise<void>;
}

/** Фикстура портфеля: форма повторяет ответы Tinkoff MCP (строковые числа, `time` у значений). */
export const PORTFOLIO_FIXTURE = {
  accountId: 'acc-1',
  currency: 'rub',
  totalValue: { value: '152345.67', currency: 'rub' },
  expectedYield: { value: '12345.67', currency: 'rub' },
  time: '2026-10-29T15:47:13Z',
  positions: [
    {
      instrumentUid: 'e6123145-9665-43e0-8413-cd61b8aa9b13',
      positionUid: '41eb2102-5333-4713-bf15-72b204c4bf7b',
      ticker: 'SBER',
      name: 'Сбербанк',
      quantity: { value: '100' },
      currentPrice: { value: '294.55', currency: 'rub' },
      positionValue: { value: '29455.00', currency: 'rub' },
    },
    {
      instrumentUid: '962e2a95-02a9-4171-8d4b-0e5a1d8e3f5a',
      positionUid: '3f5c8f1d-0e0e-4b9b-8f0e-6f5c8f1d0e0e',
      ticker: 'GAZP',
      name: 'Газпром',
      quantity: { value: '250' },
      currentPrice: { value: '168.30', currency: 'rub' },
    },
  ],
};

export const ACCOUNTS_FIXTURE = {
  accounts: [
    { id: 'acc-1', name: 'Тестовый счёт', status: 'ACCOUNT_STATUS_OPEN', currency: 'rub' },
  ],
};

const asText = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
});

/**
 * Настоящий MCP-сервер (SDK) с инструментами-фикстурами.
 * Нужен, чтобы интеграционные тесты не зависели от сети и токена брокера.
 */
export const startTestMcpServer = async (): Promise<TestMcpServer> => {
  const buildServer = (): McpServer => {
    const mcp = new McpServer({ name: 'tinkoff-test', version: '1.0.0' });

    mcp.registerTool('invest_list_accounts', { description: 'Список счётов' }, async () =>
      asText(ACCOUNTS_FIXTURE),
    );
    mcp.registerTool('invest_get_portfolio', { description: 'Портфель' }, async () =>
      asText(PORTFOLIO_FIXTURE),
    );
    mcp.registerTool('invest_get_positions', { description: 'Позиции' }, async () =>
      asText({ positions: PORTFOLIO_FIXTURE.positions }),
    );
    // Торговый инструмент: должен отсекаться allowlist'ом.
    mcp.registerTool('invest_create_order', { description: 'Заявка' }, async () =>
      asText({ orderId: 'must-not-be-called' }),
    );

    return mcp;
  };

  // Stateless-режим: транспорт создаётся на каждый запрос, иначе второй запрос
  // падает с ошибкой POST (сессия не переиспользуется).
  const httpServer = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const parsed = body ? (JSON.parse(body) as unknown) : undefined;
      const mcp = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      void (async () => {
        await mcp.connect(transport);
        await transport.handleRequest(request, response, parsed);
      })();
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
};
