# ledgerd

A tiny append-only ledger service for internal tools.

- In-process HTTP server (`src/server.js`) with pluggable routes.
- Notes are stored in a local SQLite database and searched via the notes
  search subsystem.
- Retry policy lives in `src/retry.js`.

## Development

```sh
npm install
npm test
```

## Deploy

Deployment stages are maintained by the platform team.
