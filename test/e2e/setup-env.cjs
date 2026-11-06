/**
 * E2E не отправляют трейсы в LangSmith: локальный `.env` может держать
 * LANGSMITH_TRACING=true, и тогда late-логи неудачной отправки валят прогон.
 */
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';
