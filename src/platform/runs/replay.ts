/**
 * Воспроизведение прогона по журналу: печатает транскрипт без сетевых вызовов.
 * Полное переигрывание графа на записанных ответах — режим evals (offline).
 */
export const formatReplay = (
  events: readonly Record<string, unknown>[],
  runId?: string,
): string => {
  if (events.length === 0) {
    return `Прогон ${runId ?? '—'}: журнал пуст`;
  }

  const lines = [`Прогон ${runId ?? String(events[0]?.runId ?? '—')}`];

  for (const event of events) {
    const at = String(event.at ?? '');
    switch (event.type) {
      case 'run_started':
        lines.push(`${at} старт${event.resumed ? ' (после подтверждения)' : ''}`);
        break;
      case 'tool_call':
        lines.push(`${at} вызов ${String(event.tool ?? '?')} ${JSON.stringify(event.args ?? {})}`);
        break;
      case 'tool_result':
        lines.push(`${at} результат ${String(event.tool ?? '?')}: ${event.ok === false ? 'ошибка' : 'ok'}`);
        break;
      case 'run_finished': {
        lines.push(
          `${at} итог: статус=${String(event.status)} причина=${String(event.stopReason)} ` +
            `частичный=${String(event.partial)}`,
        );
        const tools = Array.isArray(event.tools) ? event.tools : [];
        if (tools.length > 0) {
          lines.push(`  инструменты: ${tools.join(', ')}`);
        }
        const usage = event.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        if (usage) {
          lines.push(`  токены: вход ${usage.inputTokens ?? 0}, выход ${usage.outputTokens ?? 0}`);
        }
        const coverage = Array.isArray(event.coverage) ? event.coverage : [];
        for (const entry of coverage) {
          const item = entry as { source?: string; status?: string; reason?: string };
          lines.push(
            `  источник ${item.source ?? '?'}: ${item.status ?? '?'}` +
              (item.reason ? ` (${item.reason})` : ''),
          );
        }
        break;
      }
      default:
        lines.push(`${at} ${String(event.type)}`);
    }
  }

  return lines.join('\n');
};
