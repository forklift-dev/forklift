---
id: T-068
title: "GitHub: вход через браузер (OAuth device flow)"
stage: 6 — Интеграции с хостингами
status: draft
depends_on: [T-060]
updated: 2026-10-23
---

# T-068. GitHub: вход через браузер (OAuth device flow)

## Цель

Решение владельца (2026-10-23): сделать позже. Кнопка «Sign in with GitHub» в Preferences → Integrations, как в
GitKraken: приложение показывает код, открывает `github.com/login/device`, пользователь подтверждает доступ, токен
приходит сам и хранится как сейчас (safeStorage). Вход по персональному токену (T-060) остаётся.

## Контекст

- T-060: GitHub работает по персональному токену, общий слой интеграций — `src/main/hosting/`.
- Device flow (`POST https://github.com/login/device/code`, затем опрос `https://github.com/login/oauth/access_token`)
  не требует client secret: в приложение вшивается только публичный `client_id` OAuth App.
- OAuth App даёт права только целыми scope: `repo` — доступ ко всем репозиториям пользователя (как у GitKraken).
  Доступ к выбранным репозиториям — через GitHub App (токены на 8 часов с обновлением) — сложнее, не в этой задаче.

## Этапы

- [ ] Владелец регистрирует OAuth App (Settings → Developer settings → OAuth Apps, «Enable Device Flow») и даёт
      `client_id`; решить, на чей аккаунт/организацию
- [ ] Device flow в main: запрос кода, показ кода и ссылки, опрос с учётом `interval`/`slow_down`, отмена, истечение
- [ ] Кнопка и диалог в Preferences → Integrations; GitHub Enterprise — по-прежнему токеном (или свой `client_id`)
- [ ] Тесты на имитации device flow; ручная проверка владельцем

## Критерии готовности

- Вход через браузер проходит на аккаунте владельца; токен только в safeStorage
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- 2026-10-23: заведена по итогам T-060; draft — ждёт решения владельца и `client_id`.

## Промт

```text
Реализуй задачу docs/tasks/stage-6-integrations/T-068-github-oauth.md. Сначала прочитай docs/README.md, T-060 и
src/main/hosting/. client_id — от владельца (без него — статус blocked и вопрос в «Нюансах»); client secret не
нужен и не хранится. Токен — только safeStorage. По итогу: чеклист, нюансы с датой, статус review, строка в
docs/README.md, коммит.
```
