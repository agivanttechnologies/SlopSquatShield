# Getting started

Run this to install the JS client:

```bash
npm install express
```

Or grab the Python client inline: `pip install requests`.

Resolving the jackson-databind coordinate manually:

```
mvn dependency:get -Dartifact=com.fasterxml.jackson.core:jackson-databind:2.17.0
```

You can also add a dependency with `poetry add fastapi`.

```sh
uv add httpx
```

## Prose mentions (not code — must NOT be extracted)

Most people just run npm install left-pad without thinking twice.
Some tutorials tell you to pip install numpy before doing anything else.
If you use Maven, mvn dependency:get -Dartifact=org.example:example-lib:1.0.0 works too.
Poetry users often type poetry add django to get started quickly.
Everyone forgets to run uv add flask when the venv is fresh.
