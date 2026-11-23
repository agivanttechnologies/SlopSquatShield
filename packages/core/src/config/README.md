# config

Per-project configuration (FR-4.1 thresholds, FR-6.1 private scopes). It maps straight onto options
the rule engine already accepts, so there is no rule logic here — only reading and validating.

| Export | What it does |
|---|---|
| `parseConfig(text, fileName?)` | Parses and validates a `.slopsquatshieldrc` (JSON). Throws a located `ManifestParseError` on any problem. |
| `parsePackageJsonConfig(text, fileName?)` | Reads the `slopsquatshield` key out of a `package.json`; `undefined` if absent or unparseable. |
| `resolveConfig({ rc, packageJson })` | Picks one: `.slopsquatshieldrc` wins over the `package.json` key. **Never throws** — a broken config yields `{}` plus a `warning`. |

## The schema

```json
{
  "thresholds": { "minAgeDays": 30, "minWeeklyDownloads": 1000, "maxNameSimilarityDistance": 1 },
  "privateScopes": { "npm": ["@acme"], "pypi": "^acme-", "maven": ["com.acme"] }
}
```

Both sections are optional and independent. `privateScopes.npm` entries must look like `@acme`;
`pypi` is a regular-expression string (compiled to `pypiIndexPattern`); `maven` entries are
`groupId` prefixes.

## Design notes

- **Hand-validated, not a schema library**, so every mistake — an unknown key, a wrong type, a bad
  regex — is reported at the exact `file:line:column` of the offending key (NFR-3.3).
- **Fail open on a config mistake.** `resolveConfig` returns the defaults and a warning naming the
  location; callers print it and carry on. A typo in a config file must never stop an install or an
  agent — but it is never silent.
- Pure: callers read the files (the CLI via `loadProjectContext`, the extension via `workspace.fs`)
  and pass text in, so there is one parser for every surface.
