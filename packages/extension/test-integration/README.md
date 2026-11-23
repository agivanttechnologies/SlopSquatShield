# extension integration test (real VS Code)

Runs the extension inside an **actual VS Code**, downloaded by
[`@vscode/test-electron`](https://github.com/microsoft/vscode-test).

| File | Role |
|---|---|
| `run.mjs` | Creates a throwaway workspace (one `package.json` with a hallucinated and a kept dependency), launches VS Code with this extension loaded, and runs `suite.cjs` inside it. |
| `suite.cjs` | Runs *inside the extension host*, with plain `assert`. Replaces the registry through the extension's injectable `fetch` (deps.dev answers 404, so a hallucinated package needs no network). Checks: the extension activates; a BLOCK is an **Error** diagnostic ranged exactly over the dependency key; the real lightbulb offers Remove and Add-to-allowlist but **no** Did-you-mean; applying Remove leaves valid JSON and the other dependency intact. |

```bash
npm run test:integration -w slopsquatshield-vscode          # needs a display
xvfb-run -a npm run test:integration -w slopsquatshield-vscode   # headless Linux
VSCODE_VERSION=1.85.0 npm run test:integration -w slopsquatshield-vscode   # pin a version
```

On a fresh Linux box install the libraries the downloaded editor links to first:
`sudo apt-get install -y xvfb libasound2t64 libgbm1 libnss3 libgtk-3-0t64`.

## Status

**Runs in CI (the `vscode-extension` job, under `xvfb`).** That proves the extension activates and
reports in a real VS Code build; it doesn't cover Cursor, Windsurf, VSCodium or Antigravity, which
need a manual `.vsix` install, or Open VSX, in each editor.

Downloaded editors go in `.vscode-test/`, which is git-ignored.
