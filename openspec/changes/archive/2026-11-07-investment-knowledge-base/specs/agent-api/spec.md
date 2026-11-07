# Spec Delta

## MODIFIED Requirements

### Requirement: Значения intent в ответе

Поле `intent` SHALL принимать значения `data_lookup`, `security_analysis`, `portfolio_review`, `market_news`, `agent_help`, `knowledge_question` и `off_topic` и SHALL совпадать с меткой, определившей сценарий прогона.

#### Scenario: Разбор портфеля

- **WHEN** пользователь просит проанализировать портфель
- **THEN** ответ содержит `intent: "portfolio_review"`

#### Scenario: Новости рынка

- **WHEN** пользователь спрашивает последние новости инвестиционного рынка
- **THEN** ответ содержит `intent: "market_news"` и `status: "completed"`

#### Scenario: Справка о возможностях

- **WHEN** пользователь спрашивает, что умеет сервис
- **THEN** ответ содержит `intent: "agent_help"`, `status: "completed"` и не содержит блока `report`

#### Scenario: Справочный вопрос по понятию

- **WHEN** пользователь спрашивает, что такое мультипликатор P/E
- **THEN** ответ содержит `intent: "knowledge_question"`, `status: "completed"` и не содержит блока `report`

#### Scenario: Посторонний вопрос

- **WHEN** вопрос вне области агента
- **THEN** ответ содержит `intent: "off_topic"` и `status: "completed"`
