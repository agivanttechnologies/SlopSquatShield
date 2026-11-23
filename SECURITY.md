# Security policy

SlopSquatShield sits in the path of every package install and every shell command an AI agent
runs, so security reports are our top priority.

## Report a vulnerability

**Please don't open a public issue.** Report it privately:

- **GitHub:** the **Report a vulnerability** button on this repository's
  [Security tab](https://github.com/agivanttechnologies/SlopSquatShield/security/advisories/new).
- **Email:** [security@agivant.com](mailto:security@agivant.com)

Include the version (`slopsquatshield --version`), your OS and shell, the agent host if one is
involved, and the steps or input that show the problem.

## What happens next

We acknowledge every report within **2 business days**, keep you updated while we investigate, and
agree a disclosure date with you. A fix for a confirmed issue ships as a patch release, and the
advisory credits you unless you'd rather not be named.

## Actively exploited vulnerabilities

If a report shows that a vulnerability in SlopSquatShield is being actively exploited, we report it
to ENISA's single reporting platform under Article 14 of the EU Cyber Resilience Act: an early
warning within 24 hours of becoming aware of it, a notification within 72 hours, and a final report
after that. We tell the reporter when we file, and the fix and advisory follow the process above.

## Scope

**In scope:** the `slopsquatshield` CLI, the shell wrapper and CI shims, the agent hooks, the
pre-commit hook, the VS Code extension, and the launcher and config entries `init` writes. For
example:

- a way to install a package that should be blocked, through the shell wrapper or an agent hook
- a hook answer that gives an AI agent *more* permission than it had without SlopSquatShield
- data leaving the machine beyond the package names sent to the public registries
- code execution, path traversal or file overwrite through a manifest, config file or allowlist

**Out of scope:**

- **A malicious or hallucinated package on a registry.** Report it to that registry (npm, PyPI or
  Maven Central).
- **A false positive or false negative on an ordinary package.** That's a bug, not a vulnerability:
  use the "False positive" issue template.
- **The documented limits** in [What it doesn't do](README.md#what-it-doesnt-do).

## Supported versions

Security fixes go into the latest release. Please upgrade to it before reporting.
