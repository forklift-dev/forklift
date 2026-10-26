---
id: T-081
title: "Пакеты: deb/rpm, Flatpak, AUR, Homebrew, winget"
stage: 0 — Фундамент
status: draft
depends_on: [T-069, T-004]
updated: 2026-10-26
---

# T-081. Пакеты: deb/rpm, Flatpak, AUR, Homebrew, winget

## Цель

Предложение (2026-10-26): кроме AppImage — пакеты для менеджеров пакетов. У GitComet — apt-репозиторий, AUR, Gentoo GURU, Homebrew, Microsoft Store, RPM; у AngKorGit — deb/rpm/msi/dmg и Homebrew tap.

## Контекст

- Сборка — electron-builder (`electron-builder.yml`, сейчас AppImage/nsis/dmg); бета-сборки — T-069.
- deb требует `homepage` и email мейнтейнера в package.json (вопрос владельцу из T-001).

## Этапы

- [ ] deb и rpm в electron-builder
- [ ] Flatpak (Flathub) — манифест, песочница и доступ к репозиториям/git
- [ ] AUR (-bin), Homebrew cask, winget
- [ ] Публикация по тегу (T-069)

## Критерии готовности

- Пакеты ставятся и обновляются стандартными средствами ОС
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- 2026-10-26: **вопросы владельцу**: homepage и email мейнтейнера; какие каналы нужны в первую очередь.

## Промт

```text
Реализуй задачу docs/tasks/stage-0-foundation/T-081-packaging.md. Сначала прочитай docs/README.md, docs/design.md и задачи из depends_on.
Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах». По итогу: чеклист, нюансы с датой,
статус review, строка в docs/README.md, коммит.
```
