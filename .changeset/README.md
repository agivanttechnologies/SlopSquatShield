# Changesets

Release notes and version bumps for the published `slopsquatshield` package (also published,
identical, as `@agivanttechnologies/slopsquatshield`) are managed with
[Changesets](https://github.com/changesets/changesets).

- Describe a user-visible change with `npx changeset` (pick the bump: patch / minor / major).
- Breaking changes to the config format, the `.slopsquatshield` allowlist or the exit codes are a
  **major** bump (FR-16).
- A release runs `npx changeset version` (bumps `packages/cli/package.json` and writes its
  CHANGELOG) and then `npx changeset publish`.

The workspace packages `@slopsquatshield/core` and `slopsquatshield-vscode` are private and are
versioned with the repository, not published by Changesets (the CLI bundles core).
