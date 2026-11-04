# Spec Delta

## MODIFIED Requirements

### Requirement: Значения intent в ответе

Поле `intent` SHALL принимать значения `data_lookup`, `security_analysis`, `portfolio_review`, `market_news`, `agent_help` и `off_topic` и SHALL совпадать с меткой, определившей сценарий прогона.

#### Scenario: Разбор портфеля

- **WHEN** пользователь просит проанализировать портфель
- **THEN** ответ содержит `intent: "portfolio_review"`

#### Scenario: Новости рынка

- **WHEN** пользователь спрашивает последние новости инвестиционного рынка
- **THEN** ответ содержит `intent: "market_news"` и `status: "completed"`

#### Scenario: Справка о возможностях

- **WHEN** пользователь спрашивает, что умеет агент
- **THEN** ответ содержит `intent: "agent_help"` и `status: "completed"`

#### Scenario: Посторонний вопрос

- **WHEN** вопрос вне области агента
- **THEN** ответ содержит `intent: "off_topic"` и `status: "completed"`

## ADDED Requirements

### Requirement: Ответ справки без метаданных отчёта

Ответ справочной ветки MUST NOT содержать блок `report`: справка не собирает
данные и не создаёт отчёт.

#### Scenario: Справка без блока report

- **WHEN** ответ сформирован по вопросу о возможностях
- **THEN** в ответе нет поля `report`
- **AND** `partial` равно `false`

#### Scenario: Выгрузка по reportId недоступна

- **WHEN** клиент пытается получить отчёт по идентификатору из справочного ответа
- **THEN** идентификатора в ответе нет, потому что отчёт не создавался
