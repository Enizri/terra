# Security

## Reporting a vulnerability

Report privately through GitHub's [security advisory
form](https://github.com/Enizri/terra/security/advisories/new). Please don't open a
public issue for anything exploitable.

Include what you did, what happened, and which component (Go API, Python analyzer,
local LLM sidecar, web) it involved. Expect a first reply within a week.

## What Terra does with untrusted input

Terra takes a GitHub repository URL from the user and works on that repository's
contents. **A repository is untrusted input.** Two parts of the system go further
than reading it.

### Live preview executes the analyzed repository's code

`POST /preview` starts the analyzed repository's own dev server so you can see the
running app. That means installing its dependencies and running its `package.json`
scripts — arbitrary third-party code, chosen by whoever wrote the repository you
pasted. There are two runners:

- **Host-exec** (the default, and what `make dev` uses): the dev server runs
  **directly on your machine, as your user**, via `os/exec`
  (`backend/api/internal/preview/host.go`). It is not sandboxed. Do not point live
  preview at a repository you would not `git clone && npm run dev` by hand.
- **Docker** (`TERRA_PREVIEW_MODE=docker`, what Compose uses): the dev server runs in
  a sibling container (`backend/api/internal/preview/docker.go`). Better isolated
  than host-exec, but the container is not hardened — no capability drops, no
  read-only root, no memory or CPU limits — and Compose mounts
  `/var/run/docker.sock` into the api container so it can start those siblings.
  **Access to that socket is equivalent to root on the host.**

Caps that do exist: `TERRA_PREVIEW_MAX` (default 2) concurrent previews and
`TERRA_PREVIEW_TTL` (default 30m) idle shutdown. They limit resource use, not what
the code inside can do.

### Repository contents reach the model as prompt text

The analyzer sends scanned repository files to an LLM. Treat a resulting map as
derived from untrusted text: a repository can contain content written to influence
the model's output. The map is a reading aid, not an attestation.

## The access gate

`TERRA_TOKEN` is a single shared secret checked as a bearer token
(`backend/api/internal/server/auth.go`). There are no user accounts, no sessions, and
no per-user authorization.

**An empty `TERRA_TOKEN` leaves the API fully open.** That is deliberate for
loopback development, and `terra serve` refuses to bind a non-loopback address with
an empty token. `GET /models`, `GET /host/capabilities` and `/healthz` stay open even
when a token is set, so the model picker can populate before you unlock.

Terra is built to run locally or on a trusted network. Publishing it to the internet
means exposing an endpoint that fetches arbitrary repositories and, with preview
enabled, executes them — please don't do that without putting your own
authentication and sandboxing in front of it.

## Provider API keys

Keys for remote models are bring-your-own. A key is held in the browser's
`localStorage` under `terra_key_<provider>`, sent with the analyze or ask request,
forwarded to the provider, and dropped. It is never written to SQLite, a job event,
or a log, and provider errors are scrubbed before becoming event labels
(`backend/api/internal/server/model_select.go`). It is still a secret in browser
storage on a page with no user separation — use a scoped key with a spend limit.

## Supported versions

Terra is pre-1.0. Fixes land on `staging` and go out in the next release; there are
no backported patch branches.
