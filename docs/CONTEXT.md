# Terra domain language

Implementation-free glossary. Use these terms in docs, APIs, and code names.
Storage details live in [`architecture/data.md`](architecture/data.md).

## Terms

| Term | Meaning |
|---|---|
| **Project** | A GitHub repository Terra is asked to understand. Identified by a canonical repository URL. |
| **Scan** | Deterministic facts extracted from a repository tarball at a specific commit: languages, tree, dependency manifests, file lists. No LLM involved. |
| **Architecture Map** | The structured explanation of a project: project metadata, components, relationships, and suggested questions. This is what the UI draws and what Ask answers against. |
| **Analysis** | One stored result of scanning and mapping a project at a commit. Persisted in SQLite and listed under `/analyses`. |
| **Component** | A named subsystem inside an Architecture Map (for example a frontend app, mobile client, or API layer), with purpose, importance, type (`frontend` / `backend` / `database` / `infrastructure` / `mobile` / `desktop`), tech, and file evidence. |
| **App** | A runnable thing discovered in a checkout (`web` / `api` / `mobile` / `desktop` / `cli` / `library`). Owned by Go `appgraph`. A library or CLI is still an App; it is not a web UI. |
| **Relationship** | A directed edge between two Components explaining how they connect (calls, uses, reads, …) with evidence. |
| **Draft** | The LLM judgement portion of a map (description, kind, components, relationships, suggested questions) before Go merges it with Scan facts. |
| **Job** | An in-process async unit of work (probe, analyze, ask, agent) that streams NDJSON stage events to the client. Owned by Go `internal/job`. |
| **Task** | A named analyzer HTTP capability (`architecture`, `qa`, `agent`, `editor`). Public names live under Python `tasks/`. |
| **Runtime / item** | The analyzer's bounded turn loop. Items are the conversation units the runtime thinks in; Completions stays the model wire. Owned by Python `runtime/`. |
| **Role** | System-prompt copy for a kind of work (mapper, guide, editor). Owned by Python `roles/`. |
| **Tool** | A JSON schema the model may call. Schemas live in Python `tools/`; **effects** run in Go over HTTP. |
| **Retrieve** | Ranking map components and files as an index (keyword / BM25). Owned by Python `retrieve/`. |
| **Eval** | Programmatic checkers plus golden files under `case-studies/`. Owned by Python `evals/`. CI never uses an LLM-as-judge. |
| **Probe** | The cheap first half of analyze: fetch + scan + model recommendation, with no LLM map generation. |
| **Model** | An entry in Terra's static catalog that the workspace may choose for analyze/ask. Reached only through OpenAI-compatible Chat Completions (`inference/` + `local-llm`). |

## Distinctions

- A **Scan** is facts. An **Architecture Map** is judgement plus those facts.
- An **Analysis** is a persisted Architecture Map keyed by repository URL (and tagged with the commit that produced it).
- A **Task** lives in the Python analyzer. A **Job** lives in the Go API.
- A **Role** is prompt copy. A **Tool** is a schema; its side effects run in Go, not Python.
- **Component** / **Relationship** are map payload concepts, not separate SQLite tables today.
