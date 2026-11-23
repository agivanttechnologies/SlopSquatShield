# extractors/python

Python dependency extraction (FR-1.2, FR-2).

| File | Does |
|---|---|
| `index.ts` | `extractPythonDeps(filename, content)` — routes to the right parser by file name (`requirements.txt`, `pyproject.toml`, `Pipfile`). |
| `requirements.ts` | A hand-rolled PEP 508 line parser (`name[extras]specifier`; environment markers are captured, not evaluated). Comments and directives (`-r`, `-e`, `--hash`, …) are skipped, not errors. A hand-rolled regex is easier to audit than a dependency. |
| `pyproject.ts` | Both shapes a `pyproject.toml` can take: PEP 621 (`[project.dependencies]` and optional-dependency groups) and Poetry (`[tool.poetry.dependencies]`). |
| `pipfile.ts` | `[packages]` and `[dev-packages]`; handles the string form (`requests = "*"`) and the table form. |
| `import-resolution.ts` | Maps an `import` name to the PyPI *distribution* that provides it — `cv2` → `opencv-python`, `PIL` → `Pillow`, `yaml` → `PyYAML` — first by asking the active Python (`importlib.metadata.packages_distributions()`, Python 3.10+), then a curated fallback table. No interpreter on `PATH`, or one too old, is not an error: every import just falls through to the fallback (FR-2). |

## Errors

TOML manifests that don't parse throw smol-toml's error, which `scan/extract-manifest.ts` converts
into a located `ManifestParseError` (`file:line:column`). `requirements.txt` never throws.

## Tests

`test/extractors/python/`, with fixtures under `test/fixtures/pypi/`.
