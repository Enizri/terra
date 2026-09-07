# Docker Compose playground

Go serves the built UI and API at `http://127.0.0.1:8080/`. Analyzer and optional
LLM ports are available only inside the Compose network.

Create `.env` as described in the [README quickstart](../README.md#quickstart),
set a nonempty `TERRA_TOKEN` to your own shared secret, and configure the
hosted-model values:

```sh
make up
curl -sf http://127.0.0.1:8080/healthz
docker compose logs --tail=20 analyzer
# When finished:
make down
```

`make up` builds and starts API + analyzer. For local GGUF inference, set
`TERRA_LLM_URL=http://llm:8020/v1`, restore the local GGUF `TERRA_MODEL`, clear
`TERRA_LLM_API_KEY`, set `HF_HUB_OFFLINE=0` for downloads, and run `make up-llm`.

The `terra-data` volume holds `/data/terra.db` and `/data/checkouts`; the
`terra-hf-cache` volume holds local model weights. `make down` preserves these
volumes. The API image serves the web bundle from `/app/apps/web/dist`.

`TERRA_TOKEN` is required because the API binds `0.0.0.0` inside its container.
When serving the UI, Go sets an HttpOnly cookie so the browser does not need a
manual token entry. Local `make dev` forwards the token through Vite's proxy.
This shared token is not user authentication: anyone served the UI receives the
cookie. See [`SECURITY.md`](SECURITY.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| `llm UNREACHABLE` | Endpoint URL, provider key, and whether the model server is ready |
| `serving X, not Y` | `TERRA_MODEL` must identify a model served by that endpoint |
| URL points at `localhost` inside Compose | Use a hosted URL or `http://llm:8020/v1`; container localhost is not the host machine |
| Local weights cannot download | Check network access and `HF_HUB_OFFLINE`; offline mode needs already-cached weights |
| GitHub requests are rate-limited | Set `GITHUB_TOKEN` for authenticated repository requests |

The analyzer's `/healthz` can return HTTP 200 with `llm_ok: false`. A healthy
container alone does not confirm that inference works; inspect that field and the
analyzer's startup logs.

## Live preview

Preview detects runnable apps and boots supported web/API apps, plus mobile or
desktop apps with a supported preview path. Libraries and CLIs have dedicated
stages for repository information, tests, or CLI output. These operations depend
on the tools installed where the runner executes.

In host mode, repository processes run directly on the API host. In Docker mode,
supported Node apps run in sibling containers using `TERRA_PREVIEW_IMAGE`.
Go/Python and other host-only launch paths run in the API process's environment;
in the supplied Compose API image, the Go/Python toolchains are absent, so those
previews cannot boot. Docker mode is not a universal container runner.

Compose mounts the Docker socket and shares checkouts through `terra-data`.
Frameworks with configurable base paths (Vite, Angular, CRA) can use the
same-origin `/__live/{id}/` proxy. Other Node frameworks use their own loopback
origin. `TERRA_PREVIEW_MAX` limits concurrent **apps**, not repositories
(default `2`); `TERRA_PREVIEW_TTL` controls idle shutdown (default `30m`).

Live preview installs dependencies and executes the analyzed repository's code.
The editor can modify its preview checkout, but does not commit changes. Read
[`SECURITY.md`](SECURITY.md) before running an unfamiliar repository or exposing
the stack outside a trusted environment.
