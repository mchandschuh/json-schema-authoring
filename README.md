# schema-validate

`schema-validate` is a Node.js and TypeScript command-line tool for validating JSON
Schema 2020-12 documents and enforcing descriptive authoring conventions. It also
provides a local schema registry so schema collections can be discovered once and
reused for both schema authoring checks and instance validation.

## Features

- Validates JSON Schema 2020-12 documents with Ajv.
- Enforces root metadata, field documentation, naming, object-contract, reference,
  and example-quality rules.
- Validates JSON and YAML instances against schemas with structured Ajv errors.
- Resolves local relative references without network access.
- Resolves absolute `$id` references across registered schema directories.
- Registers schema directories in app, home, or environment configuration locations.
- Lists configured directories and the schemas they contain.
- Resolves complete schema documents from the local registered schema catalog.
- Supports human-readable and machine-readable JSON output.
- Exposes reusable validator, instance-validator, and registry modules.

## Requirements

- Node.js 22 or newer.
- npm.

## Install and run

For repository development:

```bash
npm ci
npm run build
node ./bin/schema-validate.js --help
```

The package exposes the `schema-validate` executable when installed or linked. The
repository also includes an installer for the companion agent skill:

```bash
./scripts/install_agent_skill.mjs "$HOME/.cline/skills"
```

The installer links the skill under the supplied skills directory and registers the
CLI with npm. The positional argument is the **skills directory**; it is not the npm
installation prefix. The npm prefix defaults to `$HOME/.local` and can be changed
with `AGENT_NPM_PREFIX`:

```bash
AGENT_NPM_PREFIX="$HOME/.local" \
  ./scripts/install_agent_skill.mjs "$HOME/.cline/skills"
```

See [`scripts/install_agent_skill.mjs`](scripts/install_agent_skill.mjs) for the
installation implementation.

## Validate schemas

```bash
# Validate one schema with human-readable findings.
schema-validate schemas/user.schema.json

# Validate multiple schemas and emit one JSON report.
schema-validate --json schemas/user.schema.json schemas/order.schema.json

# Use an explicit local reference root.
schema-validate --root schemas schemas/user/v1/user.schema.json
```

The validator applies authoring rules in positional-file mode. See the complete
rule contract and authoring workflow in [`SKILL.md`](SKILL.md).

## Validate instances

```bash
# JSON instance validation.
schema-validate \
  --root schemas \
  --schema schemas/user/v1/user.schema.json \
  --document fixtures/user.json

# YAML 1.2 instance validation.
schema-validate \
  --root schemas \
  --schema schemas/user/v1/user.schema.json \
  --document fixtures/user.yaml
```

Instance mode requires `--schema` and `--document` together. `--root` is optional
when the schema's references can be resolved from registered schema directories.
Network retrieval is never attempted.

## Schema registry

Registry configuration follows the `nodejs-common` layered-location convention:

```text
<current-working-directory>/.config/config.json   # app
~/.schema-validate/config.json                    # home
$SDLC_CONFIG/config.json                          # env, when SDLC_CONFIG is set
```

The configuration shape is:

```json
{
  "schemaRegistry": {
    "directories": ["/absolute/path/to/schemas"]
  }
}
```

Directory values may be absolute or relative to the configuration location. CLI
additions are stored as normalized absolute paths.

### Add, remove, and inspect directories

Mutations default to the home configuration location:

```bash
schema-validate registry add /home/user/src/project/schemas
schema-validate registry remove /home/user/src/project/schemas
```

Reads default to all available configuration locations:

```bash
# Show configured schema directories and where they are defined.
schema-validate registry list
schema-validate registry list --json

# Restrict the result to one location.
schema-validate registry list --config-location app
schema-validate registry list --config-location home
schema-validate registry list --config-location env
```

Select a mutation location explicitly:

```bash
schema-validate registry add /path/to/schemas --config-location app
schema-validate registry remove /path/to/schemas --config-location env
```

The `env` location requires `SDLC_CONFIG` to point to an existing absolute
directory. Registered directories are automatically available to schema authoring
and instance validation.

### List schema identifiers and paths

```bash
# Human-readable `$id` and path.
schema-validate list

# JSON inventory with `$id`, path, directory, and configuration provenance.
schema-validate list --json

# Restrict schema discovery to one configuration location.
schema-validate list --config-location home
```

The command recursively scans each registered directory for JSON files with a
non-empty `$id`, regardless of the schema dialect. Human output prints the schema
identifier and absolute file path. Authoring and reference validation still use the
tool's JSON Schema 2020-12 Ajv configuration; registering an older-dialect schema
does not make that dialect available to the validator.
JSON output has the following shape:

```json
{
  "schemas": [
    {
      "id": "https://schemas.example.test/user/v1",
      "path": "/home/user/schemas/user.schema.json",
      "directory": "/home/user/schemas",
      "definedIn": [
        {
          "location": "home",
          "configPath": "/home/user/.schema-validate/config.json"
        }
      ]
    }
  ]
}
```

## Resolve registered schemas

Read a complete schema document from the local schema catalog used by `list`:

```bash
# Full canonical URI.
schema-validate resolve https://schemas.handschuh.dev/sdlc/task-envelope/v1

# Namespace, type, and version.
schema-validate resolve sdlc/task-envelope/v1

# Match a registered schema ID by type and version.
schema-validate resolve task-envelope/v1

# Match a registered schema ID by type name.
schema-validate resolve task-envelope
```

The command iterates the complete listing generated by `list`, applies
`fullUri.includes(searchString)`, and requires exactly one match. It then reads the
matched local path and prints the complete document as formatted JSON. The search
string may be a full URI, a namespace/type/version suffix, or a filename-like schema
type. The registered URI authority is not restricted; for example,
`commit-manifest.schema.json` can match a registered
`https://schemas.1konto.dev/devops-google/.../commit-manifest.schema.json` ID.
For example, `task-envelope/v1` matches the registered full ID
`https://schemas.handschuh.dev/sdlc/task-envelope/v1`; it is not rewritten to a
default namespace before matching. No external server is contacted.

## Configuration and reference behavior

Registered directories are trusted local roots. Relative references are resolved
from the referencing document's directory. Absolute local schema identifiers are
indexed across all registered directories. References that escape every explicit or
registered root are rejected. Duplicate `$id` values should not be registered from
multiple independent files.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The test suite uses Vitest and covers the document parser, authoring rules,
validators, CLI behavior, registry configuration, schema listing, and registered
cross-directory references.

Useful repository links:

- [`SKILL.md`](SKILL.md) — detailed authoring guidance and complete CLI reference.
- [`references/research.md`](references/research.md) — research and implementation
  conventions behind the skill.
- [`scripts/install_agent_skill.mjs`](scripts/install_agent_skill.mjs) — local skill
  and npm-link installer.
- [`package.json`](package.json) — package exports, scripts, and dependencies.
- [`tests/`](tests/) — executable behavior and regression coverage.
- [`src/`](src/) — TypeScript implementation.

## Exit codes

- `0`: validation or registry operation succeeded.
- `1`: a file, configuration, schema, reference, instance, or registered schema
  document was invalid, unavailable, or ambiguous.
- `2`: command-line arguments were missing, incompatible, or invalid.