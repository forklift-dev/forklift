---
id: T-014
title: Внешние diff/merge tools
stage: 1 — Процессы и внешние программы
status: todo
depends_on: [T-012]
updated: 2026-10-22
---

# T-014. Внешние diff/merge tools

## Цель

Открыть изменения файла во внешнем diff-инструменте и разрешить конфликт во внешнем
merge-инструменте, дождавшись его закрытия и обновив состояние репозитория.

## Контекст

У git уже есть встроенная поддержка десятков инструментов (meld, kdiff3, Beyond Compare, VS Code,
vimdiff, opendiff/FileMerge, WinMerge, P4Merge…) и пользовательская настройка `diff.tool`,
`merge.tool`, `difftool.<name>.cmd`. Используем её вместо собственного списка инструментов.

## Этапы

- [ ] Diff: `git difftool --no-prompt [--tool=<tool>] [<rev>] -- <path>` через `ProcessRunner.launch({ wait: true })` + git-окружение из T-012
- [ ] Merge: `git mergetool --no-prompt [--tool=<tool>] -- <path>`; после выхода — `loadRepo` для обновления состояния
- [ ] Определить, настроен ли инструмент (`git config diff.tool` / `merge.tool`); если нет — понятная подсказка, как настроить
- [ ] IPC-команды `file:externalDiff`, `file:externalMerge`; в UI — для изменённых и конфликтных файлов
- [ ] Не блокировать UI на время работы инструмента; повторный запуск для того же файла — запретить, пока открыт первый

## Критерии готовности

- На Linux с `meld` работают diff и разрешение конфликта; после закрытия merge-инструмента
  файл пропадает из конфликтных.

## Нюансы

- `mergetool` создаёт `*.orig` (если не `mergetool.keepBackup=false`) — не показывать их как новые файлы
  без согласования с владельцем.
- Решение «конфликт разрешён» принимает git (`mergetool.<tool>.trustExitCode`), не мы.

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-014-diff-merge-tools.md через git CLI-адаптер (T-012)
и ProcessRunner.launch с ожиданием выхода. Тест: временный репозиторий с конфликтом и фиктивным
merge-инструментом (скрипт, который пишет разрешённый файл и выходит с 0), настроенным через
git config. Обнови чеклист, нюансы, статус и docs/README.md.
```
