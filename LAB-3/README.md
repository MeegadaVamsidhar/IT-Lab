# LocalCloud — Event-Driven File Sharing Platform

LocalCloud is a runnable assignment project for large-file sharing on a local network. It uses:

- **Frontend:** HTML, CSS and vanilla JavaScript
- **Backend:** Python `ThreadingHTTPServer` (event-driven request routing with worker threads)
- **Database:** SQLite (users, files, permissions, upload sessions, audit events and node health)
- **Storage:** content-addressed local storage with `.part` resumable upload files

## Run it in VS Code

```bash
python server.py
```

Open <http://localhost:8080>. A mandatory account chooser appears first for the demo users `admin`, `alice` and `bob`. The server issues an authenticated session token after selection and applies role-based access on every protected API request.

## Features covered

- Chunked uploads (8 MB by default), checksum verification and bounded memory use for multi-GB files
- Native streaming downloads with HTTP range support; the browser never loads the whole file into RAM
- Per-file owner/editor/viewer policy enforcement
- Mandatory user selection, authenticated sessions and administrator-only infrastructure controls
- Event log and audit trail
- Storage-node health simulation, automatic failover and load-aware node selection
- Live dashboard for capacity, active transfers, availability and throughput
- SQLite persistence; all state survives server restarts

## Suggested demo flow

1. Sign in as `alice`, upload a large file, pause it, refresh, and resume it.
2. Open **Sharing**, add `bob` as a viewer/editor, then sign in as `bob` in another tab.
3. Use **Operations** to simulate a node failure and watch the availability/health cards change.
4. Open **Performance** to show throughput, transfer duration and event history.

The design maps directly to OS concepts: bounded worker threads, asynchronous-style event queue, segmented I/O, recovery journals, health checks, failover and load balancing.

The default maximum file size is **50 GB**. It can be changed before startup:

```powershell
$env:LOCALCLOUD_MAX_FILE_GB=100
$env:LOCALCLOUD_CHUNK_MB=16
python server.py
```
