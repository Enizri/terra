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
| **Component** | A named subsystem inside an Architecture Map (for example a frontend app or API layer), with purpose, importance, type, tech, and file evidence. |
| **Relationship** | A directed edge between two Components explaining how they connect (calls, uses, reads, …) with evidence. |
| **Draft** | The LLM judgement portion of a map (description, kind, components, relationships, suggested questions) before Go merges it with Scan facts. |
| **Job** | An in-process async unit of work (probe, analyze, ask) that streams NDJSON stage events to the client. |
| **Task** | A named analyzer capability (`architecture`, `qa`) reached over HTTP. Tasks are typed, deterministic handlers — not autonomous agents. |
| **Probe** | The cheap first half of analyze: fetch + scan + model recommendation, with no LLM map generation. |
| **Model** | An entry in Terra's static catalog that the workspace may choose for analyze/ask. |

## Distinctions

- A **Scan** is facts. An **Architecture Map** is judgement plus those facts.
- An **Analysis** is a persisted Architecture Map keyed by repository URL (and tagged with the commit that produced it).
- A **Task** lives in the Python analyzer. A **Job** lives in the Go API.
- **Component** / **Relationship** are map payload concepts, not separate SQLite tables today.
