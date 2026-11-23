---
"slopsquatshield": major
---

First public release.

SlopSquatShield detects hallucinated and slopsquat-style packages (npm, PyPI, Maven) at install
time: a safe-install shell wrapper, hooks for AI coding agents, a manual `scan`, and an advisory
git pre-commit check. Detection is rule-based and every verdict carries a plain-English reason.
Nothing leaves your machine except the package names sent to the public registries.

Agent hosts: Claude Code, Cursor, Codex CLI and Antigravity (desktop app / CLI) hooks, each
verified in the real application. The shell wrapper covers bash, zsh and PowerShell, on Linux,
macOS, native Windows and WSL. The advisory VS Code extension runs in VS Code and the Open VSX
editors (Cursor, Windsurf, VSCodium, Antigravity). Antigravity's IDE-embedded extension (JetBrains,
Zed, Visual Studio) is not covered; see the README's Limits section.
