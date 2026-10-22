---
id: T-022
title: "Ветки: создание, переключение, удаление"
stage: 2 — Базовые git-операции
status: draft
depends_on: [T-001]
updated: 2026-10-22
---

# T-022. Ветки: создание, переключение, удаление

## Цель

Список локальных и удалённых веток, создание, checkout, удаление, переименование.

## Этапы

- [ ] Список веток в состоянии (локальные, remote, upstream, ahead/behind)
- [ ] `branch:create`, `branch:checkout`, `branch:delete`, `branch:rename`
- [ ] Поведение при грязном рабочем дереве: отказ с объяснением или stash — **решение владельца**
- [ ] UI: левая панель со списком веток

## Нюансы

- Checkout через libgit2 не запускает `post-checkout`-хуки и может вести себя иначе с LFS —
  рассмотреть checkout через git CLI.

## Промт

```text
Задача docs/tasks/stage-2-git-core/T-022-branches.md в статусе draft — сначала согласуй с владельцем
поведение при незакоммиченных изменениях и выбор libgit2 vs git CLI для checkout.
```
