import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './configuration.js';

/** Типизированный доступ к конфигурации: бросает ошибку, если секция не загружена. */
@Injectable()
export class AppConfigService {
  private readonly appConfig: AppConfig;

  constructor(private readonly config: ConfigService) {
    this.appConfig = {
      app: this.require('app'),
      llm: this.require('llm'),
      mcp: this.require('mcp'),
      state: this.require('state'),
      approvals: this.require('approvals'),
      langsmith: this.require('langsmith'),
    };
  }

  get value(): AppConfig {
    return this.appConfig;
  }

  private require<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const section = this.config.get<AppConfig[K]>(key);
    if (section === undefined) {
      throw new Error(`Секция конфигурации "${String(key)}" не загружена`);
    }
    return section;
  }
}
