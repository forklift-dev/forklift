# Forklift

Desktop Git client built with Electron 45, React 19, TypeScript 7 and Vite 8 (via electron-vite).
Architecture borrows the proven parts of GitKraken Desktop and its open-source Git stack.

Project documentation (architecture, decisions, staged task list) lives in [docs/](docs/README.md).

## Architecture

```
main process (src/main)
  Redux Toolkit store ── source of truth for app state
  git/service.ts ─────── @axosoft/nodegit (GitKraken's libgit2 fork)
  replication.ts ─────── mirrors the store into renderers over a MessagePort
  ipc/registry.ts ────── typed command table → ipcMain.handle, replies after the replica acks
        │  MessagePort: STATE snapshot, then UPDATE {changed slices, updateIndex} → ack
        ▼
preload (src/preload) ── contextBridge: window.forklift { invoke, onReplicaMessage, ackReplicaUpdate }
        ▼
renderer (src/renderer) ─ React 19, read-only replica via useSyncExternalStore, commands via invoke()
```

- **State** lives only in the main process. Renderers hold a read-only replica and change it
  only by calling commands (`src/shared/ipc.ts`). A command's promise resolves after the
  renderer has applied the resulting state, so UI code can rely on fresh state after `await`.
- **Security**: `contextIsolation`, `sandbox`, no `nodeIntegration`; renderer served from
  `app://forklift/` (not `file://`); IPC senders are checked against the app origin;
  Electron fuses are locked down at packaging time (`electron-builder.yml`).
- **Git stack** (open-source parts of GitKraken's): `@axosoft/nodegit` (MIT), `nsfw` (MIT,
  file watching), `find-git-repositories` (MIT). GitKraken's own spawn server and socket bridge are
  proprietary and not used.

## Requirements

nodegit has no prebuilt binaries for current Electron, so it is compiled from source on
`npm install` (`scripts/rebuild-native.mjs`). OpenSSL 3 is linked statically: built from source
on Linux, downloaded prebuilt (SHA-256 verified) from the nodegit fork's bucket on macOS/Windows.

| OS | Toolchain |
|---|---|
| Linux | `build-essential`, `python3`, `perl`, `libkrb5-dev` |
| macOS | Xcode Command Line Tools, `python3` |
| Windows | Visual Studio 2022 Build Tools (Desktop C++), `python3` |

Node.js ≥ 22.12. Build every OS/CPU architecture (x64, arm64) on a matching machine or CI
runner; cross-compiling nodegit is not supported.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Build to `out/` |
| `npm test` | Vitest, run inside Electron's Node (native modules use Electron's ABI) |
| `npm run typecheck` / `npm run lint` | TypeScript / oxlint |
| `npm run rebuild:native` | Force rebuild native modules (after changing Electron version) |
| `npm run dist` | Package for the current OS into `dist/` |
