/**
 * Открывает LangSmith Studio в отдельном окне браузера с изолированным профилем.
 *
 * Ваши вкладки и сессия не затрагиваются: используется собственный
 * `--user-data-dir` (`.browser-profile` в репозитории) и режим `--app`
 * (окно без адресной строки и без ваших вкладок). Логин в LangSmith
 * потребуется один раз — дальше профиль его помнит.
 *
 *   npm run studio:open            (порт из STUDIO_PORT, по умолчанию 2024)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const port = process.env.STUDIO_PORT ?? '2024';
const url = `https://smith.langchain.com/studio?baseUrl=http://127.0.0.1:${port}`;

/** Chromium-браузеры с поддержкой `--app` и отдельного профиля, в порядке предпочтения. */
const candidates = [
  join(process.env['ProgramFiles'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env['LOCALAPPDATA'] ?? '', 'Yandex/YandexBrowser/Application/browser.exe'),
  join(process.env['ProgramFiles'] ?? '', 'Yandex/YandexBrowser/Application/browser.exe'),
];

const browser = candidates.find((path) => path && existsSync(path));
const profileDir = resolve('.browser-profile');

if (!browser) {
  console.log(
    [
      'Chromium-браузер не найден (Chrome/Edge/Yandex) — откройте вручную:',
      url,
    ].join('\n'),
  );
  process.exit(0);
}

mkdirSync(profileDir, { recursive: true });

const child = spawn(
  browser,
  [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ],
  { detached: true, stdio: 'ignore' },
);
child.unref();

console.log(
  [
    `Studio открыт в отдельном окне: ${browser}`,
    `Профиль (не ваш основной): ${profileDir}`,
    url,
  ].join('\n'),
);
