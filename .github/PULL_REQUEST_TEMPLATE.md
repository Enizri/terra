## Summary

<!-- What changed and why. Link the tracking issue. -->

**Base branch:** `staging` (not `main`)

Fixes #

## Checklist

- [ ] PR targets **`staging`**
- [ ] Branched from latest `staging`
- [ ] One concern only (matches the linked issue)
- [ ] `make check` is green on this PR
- [ ] `actionlint` is green on this PR (workflow lint; temporary merge-gate peer)
- [ ] Behavior-preserving unless the issue says otherwise

## Test plan

- [ ] `make check`
- [ ] Ticket-specific command from the issue (e.g. `make test-go` / `make test-py`)
