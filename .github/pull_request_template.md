## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How it was tested

<!-- New or changed tests, and anything you ran by hand (which OS, shell, agent host). -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`), per the DCO in CONTRIBUTING.md
- [ ] `npm test`, `npm run lint` and `npx tsc --noEmit -p packages/<each package>` pass
- [ ] A user-visible change has a changeset (`npx changeset`)
- [ ] Detection logic lives in `packages/core` only; the CLI, hooks and extension just call it
- [ ] Anything that can't be checked fails open (exit 3, "not verified"), never as a finding
- [ ] Every new BLOCK or WARN says why in plain English
- [ ] No new network destination, and no telemetry
- [ ] Docs don't claim support for a host or platform nobody has verified
