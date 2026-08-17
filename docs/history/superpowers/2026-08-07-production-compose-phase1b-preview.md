# Phase 1b — Docker sibling preview

## Approach
1. Checkout under `TERRA_CHECKOUT_DIR` (Compose: `/data/checkouts`) so api + sandbox share files.
2. `dockerRunner` spawns sibling container (Node image) with checkout mount; FE listens on fixed internal port `5173`.
3. API reaches sandbox via Docker DNS / `host.docker.internal` published port.
4. **Path proxy** on main API: `http://127.0.0.1:8080/__live/{id}/` (iframe works through published `:8080`). Host mode keeps ephemeral loopback proxy.
5. Caps: max concurrent previews (default 2), idle TTL (default 30m).
6. Traces: `TERRA_TRACE_URL=http://host.docker.internal:8080/traces/ingest` + `TERRA_TRACE_TOKEN` Bearer in hook.
7. Compose: mount `docker.sock`, set `TERRA_PREVIEW_MODE=docker`, `extra_hosts: host.docker.internal:host-gateway`.

## Non-goals
- Firecracker, multi-node, generalizing memos auth seed (keep as-is against sandbox URL).
