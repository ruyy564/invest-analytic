import { MultiServerMCPClient } from '@langchain/mcp-adapters';

/**
 * Живая проверка подключения к MCP сервера Tinkoff Invest.
 * Запуск: npm run smoke:mcp (нужны MCP_TINKOFF_URL и MCP_TINKOFF_TOKEN в .env).
 *
 * Если сервер отдаёт сертификат, которому не доверяет локальное хранилище
 * (корпоративный прокси/УЦ), используйте NODE_EXTRA_CA_CERTS=/path/to/ca.pem
 * или NODE_TLS_REJECT_UNAUTHORIZED=0 для разовой проверки.
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

const started = Date.now();
try {
  const tools = await client.getTools('tinkoff');
  console.log('OK', Date.now() - started, 'мс; инструменты:', tools.map((tool) => tool.name).join(', '));

  const accounts = tools.find((tool) => tool.name === 'invest_list_accounts');
  if (accounts) {
    console.log('счета:', preview(await accounts.invoke({})));
  }

  const portfolio = tools.find((tool) => tool.name === 'invest_get_portfolio');
  if (portfolio && accountId) {
    const result = await portfolio.invoke({ accountId });
    const text = preview(result);
    console.log('портфель:', text);
    if (!/SBER|GAZP|\d/.test(text)) {
      console.error('в ответе портфеля нет данных');
      process.exit(2);
    }
  } else if (portfolio) {
    console.log('портфель: пропущено (TINKOFF_ACCOUNT_ID не задан)');
  }

  console.log('smoke: ok');
  process.exit(0);
} catch (error) {
  console.error('smoke: ошибка —', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
