# Loop engineering

Outer control loop for AI-assisted development (complements Google SWE trunk + presubmit).

## Stop condition

```bash
pnpm verify
```

## Loops

| Loop | Trigger | Verify | Human gate |
|------|---------|--------|------------|
| PR | pull_request | CI verify | CODEOWNERS merge |
| Implement | plan todo | verify + targeted tests | none |
| RC | saas-rc tag / dispatch | staging smoke + load test | before prod |
| Publish | Changesets | npm publish | maintainer |
| Build cop | main red | revert or fix | build cop |

## Maker ≠ checker

Implementing agent must not be the sole reviewer. Use Bugbot / human CODEOWNERS / security-review subagent.
