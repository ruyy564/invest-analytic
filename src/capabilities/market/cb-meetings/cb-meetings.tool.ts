import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../transports/mcp/tool-schema.js';
import { formatCbMeetings, loadCbMeetings } from './cb-meetings.js';

/** Локальный инструмент расписания ЦБ: план заседаний из файла-данных. */
export const CB_MEETINGS_TOOL = 'macro__cb_meetings';

/**
 * Календарь заседаний ЦБ: даты решений по ставке.
 * Нужен блоку «чего ждём»: «18.12 — заседание ЦБ» — факт, «скоро заседание» — догадка.
 */
export const createCbMeetingsTool = (options: { file: string; now?: () => Date }): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: CB_MEETINGS_TOOL,
    description:
      'Ближайшие заседания ЦБ по ключевой ставке: даты из плана регулятора. ' +
      'Для вопросов «чего ждём», «когда заседание ЦБ».',
    schema: toZodV3({ type: 'object', properties: {} }) as never,
    func: async () => formatCbMeetings(loadCbMeetings(options.file), options.now?.() ?? new Date()),
  } as never);
