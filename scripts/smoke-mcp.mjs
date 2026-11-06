import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { McpProxyService } from '../dist/transports/mcp/mcp-proxy.service.js';

/**
 * Живая проверка подключения к MCP сервера T-Invest.
 * Запуск: npm run smoke:mcp (нужны MCP_TINKOFF_URL и MCP_TINKOFF_TOKEN в .env).
 *
 * Сервер отдаёт ответы потоком SSE, и `@langchain/mcp-adapters` не дожидается конца
 * `tools/list`, поэтому при таймауте повторяем проверку через локальный прокси —
 * тот же путь, которым ходит приложение.
 *
 * Если сервер отдаёт сертификат, которому не доверяет локальное хранилище,
 * используйте NODE_EXTRA_CA_CERTS=/path/to/ca.pem (см. scripts/fetch-mcp-ca.mjs).
 */
const url = process.env.MCP_TINKOFF_URL;
const token = process.env.MCP_TINKOFF_TOKEN;
const accountId = process.env.TINKOFF_ACCOUNT_ID;

if (!url) {
  console.error('MCP_TINKOFF_URL не задан — заполните .env');
  process.exit(1);
}

const client = new MultiServerMCPClient({
  prefixToolNameWithServerName: false,
  mcpServers: {
    tinkoff: {
      transport: 'http',
      url,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    },
  },
});
const preview = (value) => JSON.stringify(value).slice(0, 400);

const reportTools = (tools, label) => {
  console.log(`OK ${label}; инструменты (${tools.length}):`);
  for (const tool of tools) {
    console.log(' -', tool.name);
  }
};

/** Подключение к локальному прокси: схема адаптера требует явного `mode: legacy`. */
const legacyHttp = (target) => ({ transport: 'http', mode: 'legacy', url: target });

const reportPortfolio = async (tools) => {
  const getPortfolio = tools.find((tool) => tool.name === 'invest_get_portfolio');
  if (!getPortfolio || !accountId) {
    console.log('портфель: пропущено (нет инструмента или TINKOFF_ACCOUNT_ID)');
    return;
  }
  const text = preview(await getPortfolio.invoke({ accountId }));
  console.log('портфель:', text);
  if (!/accountId|positions|totalAmount/i.test(text)) {
    console.error('в ответе портфеля нет ожидаемых полей');
    process.exitCode = 2;
  }
};

const started = Date.now();
try {
  const tools = await client.getTools('tinkoff');
  reportTools(tools, `${Date.now() - started} мс (прямое подключение)`);
  await reportPortfolio(tools);
  console.log('smoke: ok');
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/timed out/i.test(message)) {
    console.error('smoke: ошибка —', message);
    process.exitCode = 1;
  } else {
    console.log('smoke: прямой вызов завершился таймаутом, повторяю через локальный прокси');
    const proxy = new McpProxyService({ value: {} });
    const local = await proxy.start({ name: 'tinkoff', url, token });
    const proxied = new MultiServerMCPClient({
      prefixToolNameWithServerName: false,
      mcpServers: { tinkoff: legacyHttp(local) },
    });
    try {
      const proxiedStarted = Date.now();
      const tools = await proxied.getTools('tinkoff');
      reportTools(tools, `${Date.now() - proxiedStarted} мс (через прокси)`);
      await reportPortfolio(tools);
      console.log('smoke: ok (через прокси)');
      process.exitCode = 0;
    } catch (proxyError) {
      console.error('smoke: ошибка через прокси —', proxyError?.message ?? proxyError);
      process.exitCode = 1;
    } finally {
      await proxied.close();
      // У прокси нет публичного `stop`: закрываем слушающий сокет напрямую.
      proxy.server?.close();
    }
  }
} finally {
  await client.close();
  const exitCode = process.exitCode ?? 0;
  // Выход — через `process.exit`: LangSmith-транспорт в `client.close()` может держать сокет.
  setTimeout(() => process.exit(exitCode), 100).unref();
}
