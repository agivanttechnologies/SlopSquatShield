# shell — the human-side wrapper

Makes a plain `npm install` / `pip install` / `mvn …` typed at a terminal go through SlopSquatShield
first (FR-11). **Best-effort**, not a guarantee: calling the package manager by absolute path, or a
program that spawns it directly, skips it. (The agent hooks are the enforcement boundary for agents.)

| File | Role |
|---|---|
| `snippet.ts` | The shell functions and how they're installed. `buildBashZshSnippet()` / `buildPowerShellSnippet()` define `npm`, `pip` and `mvn` as functions calling the **launcher** by fixed path (a function is resolved before `PATH`, so it shadows the real binary without touching `PATH`). Wrapped in `# >>> slopsquatshield shell wrapper >>>` markers; `installSnippetToFile` **upserts** between them — appends if absent, no-op if identical, replaces in place if it's an older form (so re-running `init` repairs the legacy bare-name snippet). `snippetState` reports `current` / `outdated` / `absent`. | `removeSnippetFromFile` is the inverse of the installer (used by `uninstall`): it removes the marked block and the blank line before it, deletes a file that held only our block, and leaves everything else alone.
| `profile-paths.ts` | Where each shell's profile lives: `~/.bashrc`, `~/.zshrc`, and the PowerShell profiles. On Windows that is **two** files — PowerShell 7 (`Documents/PowerShell/…`) and Windows PowerShell 5.1, the `powershell.exe` that ships with Windows (`Documents/WindowsPowerShell/…`) — and one (`~/.config/powershell/…`) elsewhere. `powerShellProfiles()` takes `platform`, so the Windows paths are testable anywhere. Every function takes `home`, because `os.homedir()` on Windows ignores a `HOME` override — a test that tried to sandbox it that way once wrote into the real profile. |
| `ci-shim.ts` | `--ci` mode (FR-11.2): non-interactive and CI shells never read a profile, so this writes real `npm`/`pip`/`mvn` **executables** (plus `.cmd` on Windows) into `~/.config/slopsquatshield/shims`, to be put earlier on `PATH`. Each shim exports `SLOPSQUATSHIELD_SHIM_DIR` so the wrapper can strip its own directory before forwarding — otherwise the wrapper's `npm` lookup finds the shim and **recurses forever**. `init --ci` can't change the parent shell's `PATH`; the CI config adds the directory. |
| `documents-dir.ts` | `detectDocumentsDir()` — on Windows, asks `powershell.exe` where Documents really is (OneDrive's folder backup moves it, and a profile written under the plain `<home>\Documents` is then never read). Returns `undefined` elsewhere or on any failure, and `init`/`doctor`/`uninstall` fall back to `<home>\Documents`. Called only by those three, never on the hook or wrapper path. |
| `wsl.ts` | `detectWslHome()` — on a Windows host with WSL, finds the distro's *real* home (a Windows Node's `os.homedir()` is the Windows profile) and a Windows-writable UNC path to it, so `init` can write the wrapper into the distro's `~/.bashrc`. A no-op on Linux, macOS and Windows without WSL. |

## Verification status

A real interactive `bash --rcfile` session and a real `powershell.exe` session have been seen
resolving `npm` to the wrapper and BLOCKing a nonexistent package. **zsh has not been tested in a live
session**, and macOS and native-Windows CI legs have never run.

## Tests

`test/shell/`. WSL detection mocks `wsl.exe` — no test spawns it.
