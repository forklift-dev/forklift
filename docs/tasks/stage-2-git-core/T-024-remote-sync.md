---
id: T-024
title: Fetch, pull (merge и rebase), push; учётные данные в UI
stage: 2 — Основная работа внутри приложения
status: todo
depends_on: [T-012, T-011]
updated: 2026-10-22
---

# T-024. Fetch, pull (merge и rebase), push; учётные данные в UI

## Цель

Синхронизация с удалёнными репозиториями по HTTPS и SSH с прогрессом и отменой; запрос учётных
данных в окне приложения.

## Решение владельца (2026-10-22)

- Pull поддерживает **merge и rebase**: выбор в UI (по умолчанию — из `pull.rebase` в git config).
  Fast-forward-only отдельно не предлагаем.

## Этапы

- [ ] Fetch/pull/push через GitCli с `--progress`, разбор прогресса в состояние, отмена (AbortSignal)
- [ ] Pull: merge или rebase; конфликты → T-025; остановленный rebase — продолжить/прервать
- [ ] Учётные данные: системный credential helper (GCM, osxkeychain, libsecret) + свой `GIT_ASKPASS`-мост
      для логина/пароля/passphrase в UI
- [ ] SSH: ssh-agent (`SSH_AUTH_SOCK` из окружения shell, T-011), подтверждение нового хоста
- [ ] Секреты не попадают в состояние и логи

## Нюансы

- askpass-мост GitKraken (`rust-socket-bridge`) проприетарный — свой: маленький askpass-скрипт, связь с
  приложением через сокет/именованный канал. Дизайн описать в задаче до реализации.

## Промт

```text
Реализуй docs/tasks/stage-2-git-core/T-024-remote-sync.md. Сначала опиши дизайн askpass-моста в задаче,
затем fetch/pull (merge и rebase)/push с прогрессом и отменой. Тесты — с локальным bare-репозиторием как remote.
```
