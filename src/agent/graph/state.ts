import { MessagesValue, StateSchema } from '@langchain/langgraph';
import * as z from 'zod';

/** Состояние прогона: история сообщений, интент, признаки ответа и время данных. */
export const AgentState = new StateSchema({
  messages: MessagesValue,
  intent: z.enum(['portfolio', 'off_topic']).default('off_topic'),
  partial: z.boolean().default(false),
  dataAsOf: z.string().optional(),
  /** Время постановки в `interrupt` — для проверки срока подтверждения. */
  approvalRequestedAt: z.string().optional(),
});

export type AgentStateType = typeof AgentState.State;
