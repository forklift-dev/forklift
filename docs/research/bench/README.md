# Замеры к competitors-2026-10.md

Скрипты в том виде, в каком их запускали 2026-10-26. Пути к репозиториям и бинарникам указывают на временную
папку той сессии: перед повтором поправьте переменные `S`/`B` в начале файлов.

- `launch_bench.py` — запуск любого приложения в Xvfb с чистым HOME: время до окна, «затихание» по CPU, PSS дерева
  процессов, скриншот.
- `bench-competitors.sh` — AngKorGit, GitComet и Forklift на git/git, linux и wide, по 2 раза.
- `bench-final.sh` — итоговый прогон трёх приложений, без и с commit-graph; `results/final.jsonl` — его сырые результаты.
- `bench-ours.mjs`, `first-rows.mjs`, `bench-linux-debug.mjs`, `diff-probe.mjs` — Forklift через DevTools (E2E_BINARY с
  упакованной сборкой): первые строки графа, прокрутка, скачки, status, diff, память по процессам.
