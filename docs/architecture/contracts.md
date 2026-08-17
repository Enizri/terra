# Contracts

Canonical JSON Schema and fixtures live under [`contracts/`](../../contracts/README.md).

| Contract | Purpose |
|---|---|
| `analysis-map/v1` | Stored / UI Architecture Map |
| `analyzer/v1/request` | Go → Python `POST /analyze` |
| `analyzer/v1/response` | Python → Go analyze reply |

Language-native types (Go `internal/analysis`, Python `terra_analyzer.contracts`,
TypeScript feature map types) mirror these schemas by hand.
`make check-contracts` fails on drift.

Task names `architecture` and `qa` are part of the public surface.
