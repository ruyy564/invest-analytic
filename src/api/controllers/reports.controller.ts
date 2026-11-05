import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service.js';
import { ReportStoreService } from '../../state/report-store.service.js';

export const REPORT_FORMATS = ['md', 'json', 'html'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** Выгрузка готового отчёта: markdown, json или html (для печати и PDF). */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly store: ReportStoreService,
    private readonly config: AppConfigService,
  ) {}

  @Get(':reportId')
  get(
    @Param('reportId') reportId: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): unknown {
    const chosen = (REPORT_FORMATS as readonly string[]).includes(format ?? '')
      ? (format as ReportFormat)
      : 'md';
    const report = this.store.get(reportId, this.config.value.app.userId);

    if (!report) {
      console.warn('[reports] выгрузка не нашла отчёт:', reportId, 'user:', this.config.value.app.userId);
      response.status(404);
      return {
        error: {
          code: 'REPORT_NOT_FOUND',
          message: 'Отчёт не найден',
          requestId: '',
        },
      };
    }

    if (chosen === 'json') {
      response.header('content-type', 'application/json; charset=utf-8');
      return JSON.parse(report.json) as unknown;
    }
    if (chosen === 'html') {
      response.header('content-type', 'text/html; charset=utf-8');
      return `<article><pre>${report.markdown.replace(/[<>&]/g, (char) =>
        char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;',
      )}</pre></article>`;
    }

    response.header('content-type', 'text/markdown; charset=utf-8');
    return report.markdown;
  }
}
