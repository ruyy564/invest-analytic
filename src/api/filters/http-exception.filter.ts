import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ApprovalExpiredError, NotAwaitingApprovalError } from '../../agent/approval.errors.js';
import { ConfigError } from '../../config/config.error.js';
import { ToolError } from '../../tools/errors.js';
import { ApiValidationError } from '../dto/agent.dto.js';

export interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

interface MappedError {
  status: number;
  code: string;
  message: string;
}

const mapError = (error: unknown): MappedError => {
  if (error instanceof ApiValidationError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof NotAwaitingApprovalError) {
    return { status: 409, code: error.code, message: error.message };
  }
  if (error instanceof ApprovalExpiredError) {
    return { status: 410, code: error.code, message: error.message };
  }
  if (error instanceof ToolError) {
    return { status: 503, code: error.code, message: 'Данные брокера сейчас недоступны' };
  }
  if (error instanceof ConfigError) {
    return { status: 500, code: 'CONFIG_ERROR', message: 'Некорректная конфигурация сервиса' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервиса' };
};

/**
 * Единый формат ошибок: `{error:{code,message,requestId}}` на русском,
 * без стектрейсов, токенов и URL с секретами.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<{ headers: Record<string, string>; url?: string }>();
    const requestId = request.headers['x-request-id'] ?? randomUUID();
    const mapped = mapError(error);

    this.logger.warn(`${mapped.code} ${mapped.status} ${request.url ?? ''} requestId=${requestId}`);

    const body: ErrorBody = {
      error: { code: mapped.code, message: mapped.message, requestId },
    };
    response.status(mapped.status).json(body);
  }
}
