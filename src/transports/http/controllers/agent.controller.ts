import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AgentRunnerService, type RunResult } from '../../../agent/agent-runner.service.js';
import { toServerSentEvent } from '../../../agent/runner/run-events.js';
import {
  approveRequestSchema,
  chatRequestSchema,
  parseOrThrow,
} from '../dto/agent.dto.js';

export interface ChatResponse extends RunResult {
  requestId: string;
  sessionId: string;
}

@Controller('agent')
export class AgentController {
  constructor(private readonly runner: AgentRunnerService) {}

  @Post('chat')
  async chat(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChatResponse> {
    const dto = parseOrThrow(chatRequestSchema, body);
    const requestId = randomUUID();
    const sessionId = dto.sessionId ?? randomUUID();

    const result = await this.runner.run(dto.message, sessionId, requestId);
    response.status(result.status === 'awaiting_approval' ? 202 : 200);

    return { requestId, sessionId, ...result };
  }

  @Post('chat/stream')
  async streamChat(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const dto = parseOrThrow(chatRequestSchema, body);
    const requestId = randomUUID();
    const sessionId = dto.sessionId ?? randomUUID();

    // SSE: клиент видит этапы прогона до итогового ответа.
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    for await (const event of this.runner.stream(dto.message, sessionId, requestId)) {
      response.write(toServerSentEvent(event));
    }
    response.end();
  }

  @Post('runs/:runId/cancel')
  cancelRun(@Param('runId') runId: string): { runId: string; cancelled: boolean } {
    // Повторная отмена идемпотентна: второй вызов вернёт false.
    return { runId, cancelled: this.runner.cancel(runId) };
  }

  @Post('chat/approve')
  async approve(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChatResponse> {
    const dto = parseOrThrow(approveRequestSchema, body);
    const requestId = randomUUID();

    const result = await this.runner.resume(
      dto.sessionId,
      {
        approved: dto.approved,
        comment: dto.comment,
      },
      requestId,
    );
    response.status(result.status === 'awaiting_approval' ? 202 : 200);

    return { requestId, sessionId: dto.sessionId, ...result };
  }
}
