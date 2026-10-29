---
name: json-schema-authoring
description: Create complete, descriptive JSON Schema 2020-12 documents and validate them with the schema-validate Node.js CLI.
metadata:
  category:
    - schema-design
    - validation
    - agent-tooling
  tags:
    - json-schema
    - schema-2020-12
    - ajv
    - typescript
    - nodejs
    - validation
    - examples
  triggers:
    - "create a JSON schema"
    - "write a JSON Schema"
    - "validate a schema"
    - "schema conventions"
    - "schema-validate"
    - "document JSON fields"
    - "add schema examples"
  file_patterns:
    - "**/*.schema.json"
    - "**/schema*.json"
    - "**/schemas/**/*.json"
    - "**/json-schema-authoring/**"
  intent_patterns:
    - create
    - design
    - validate
    - refactor
    - document
    - test
  priority: 0.9
  auto_load: false
  auto_activate: false
  capabilities:
    - json_schema_design
    - schema_2020_12_validation
    - descriptive_field_documentation
    - example_quality_checks
    - node_cli_validation
    - python_validator_guidance
  failure_modes:
    - missing_dialect
    - missing_identifier
    - undocumented_field
    - missing_example
    - open_object_contract
    - unknown_required_field
    - invalid_example
    - unresolved_reference
  token_budget: medium
  anti_triggers:
    - "validate JSON instance data only"
    - "JSON parsing without schema design"
    - "JSON serialization format only"
  activation:
    min_similarity: 0.8
    require_file_match: false
    require_intent_match: true
---

# JSON Schema Authoring

Use this skill when creating, reviewing, or changing a JSON Schema document. The
goal is a schema that is valid JSON Schema, useful to humans and code generators,
complete enough to prevent accidental data drift, and easy for another agent to
extend safely.

The companion application is installed as `schema-validate`. It uses TypeScript,
Node.js, and Ajv's JSON Schema 2020-12 implementation by default. Run it before
handing off a schema or declaring a schema-related task complete.

## Agent workflow

Follow these steps in order:

1. **Inspect the repository first.** Find existing schemas, the target API/config
   contract, generated types, test fixtures, package manager, and language mix.
   Preserve local conventions when they are stricter than this skill.
2. **Research the contract.** Identify each field's meaning, lifecycle, nullability,
   units, allowed values, security sensitivity, and whether it is required. Do not
   infer a business rule from a field name alone.
3. **Choose the validator.** Prefer `schema-validate` for Node.js/TypeScript
   repositories. In a Python-heavy repository, use the installed `jsonschema`
   package or the repository's existing wrapper as a second validator. Do not add a
   new package without following the repository's package-manager policy.
4. **Write the schema contract.** Start with the root metadata below, then add
   properties, constraints, reusable `$defs`, required fields, and examples.
5. **Make object boundaries explicit.** Decide whether unknown properties are
   rejected. For this skill, ordinary object definitions should use
   `additionalProperties: false`; use `patternProperties` for intentionally open
   maps and document the key/value contract.
6. **Validate examples as data.** Every example should be realistic, minimal enough
   to teach the contract, and valid against the subschema where it appears. Include
   representative boundary values when they clarify a constraint.
7. **Run the validator and tests.** Use the exact commands in the CLI section. Fix
   every error; do not suppress a rule because it is inconvenient.
8. **Review the diff.** Check that the schema is complete, descriptions are useful
   rather than restating a type, examples contain no secrets, and references do not
   depend on an undocumented retrieval environment.

## Canonical root shape

New schemas should normally begin like this:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.handschuh.dev/widget/v1",
  "title": "Widget",
  "description": "A widget returned by the inventory service.",
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false,
  "examples": [{}]
}
```

Replace the placeholder values. `$id` is an identifier, not a promise that the
validator will fetch a URL. Use a stable absolute URI and keep it unique within the
schema registry. `$schema` declares the dialect; this skill targets 2020-12.

### Local schema URI constants

Schemas defined in this repository use the following public URI authority and
templates:

```text
SCHEMA_DOMAIN = "https://schemas.handschuh.dev"
SCHEMA_URI_TEMPLATE = "https://schemas.handschuh.dev/<type>/v<major>"
SDLC_SCHEMA_URI_TEMPLATE = "https://schemas.handschuh.dev/sdlc/<type>/v<major>"
```

Use `SCHEMA_URI_TEMPLATE` for a locally defined non-SDLC schema. Use
`SDLC_SCHEMA_URI_TEMPLATE` for an SDLC contract, replacing `<type>` with a
lower-kebab-case contract type such as `task-envelope`, `task-design`, or
`evidence`, and replacing `<major>` with the version number. For example:

```json
{
  "$id": "https://schemas.handschuh.dev/sdlc/task-design/v1"
}
```

These are stable identifiers for the local schema registry; they do not authorize
network retrieval. Validators MUST resolve them to registered local schema files.
Do not use the JSON Schema `$schema` keyword or an instance property named
`schema` as a substitute for the `$id` URI. `$schema` identifies the dialect of a
schema document, while an application-level selector identifies which schema
resource validates an instance.

For SDLC task envelopes, `task.taskSchema` in
`https://schemas.handschuh.dev/sdlc/task-envelope/v1` is the canonical
application-level selector for the complete task contract. It MUST be an absolute
`SDLC_SCHEMA_URI_TEMPLATE` URI without a fragment. Root-specific `intentSchema`
and `resultSchema` values MAY identify the corresponding `#/properties/intent` and
`#/properties/result` subschemas, but they MUST be absolute URI references, resolve
under the selected `taskSchema`, and agree with `taskType`. The envelope's
instance-level `schema` field MUST also contain the full URI
`https://schemas.handschuh.dev/sdlc/task-envelope/v1`; compact values such as
`sdlc-task-envelope/v1` are not canonical and are rejected by the
`schema-references` authoring rule. The same convention applies to every
schema-valued field, including `outputSchema`, `inputSchema`, and nested source
schema fields. Ordinary strings, filesystem paths, and `$ref` values are separate
namespaces and are not rewritten by this rule.

`title` is short and readable. `description` explains purpose, semantics, units,
allowed relationships, or operational implications. `examples` is an array; it is
annotation in JSON Schema, but this skill requires at least one example and the CLI
checks its validity against the root schema.

## Naming and structure conventions

### Names

- Use **lowerCamelCase** for JSON property names: `createdAt`, `accountId`,
  `retryPolicy`.
- Use **PascalCase** for `$defs` names: `Address`, `RetryPolicy`, `ErrorDetail`.
- Use `snake_case` only when an external protocol already fixes that spelling;
  document the exception and expect the naming rule to report it.
- Prefer nouns for values and clear verb phrases for booleans (`isEnabled`,
  `hasAccess`). Avoid ambiguous names such as `data`, `value`, or `type` unless the
  surrounding contract makes their meaning precise.
- Keep one canonical spelling. Do not create aliases merely to accommodate a
  guessed future client.

### Objects and fields

- Put named fields under `properties`; use `patternProperties` for a deliberate map
  rather than silently accepting arbitrary keys.
- `properties` does **not** make a field required. List required fields explicitly in
  `required`. The validator requires that every required name is declared and that
  names are unique.
- Close ordinary objects with `additionalProperties: false` (or use
  `unevaluatedProperties: false` when composed schemas need evaluation-aware
  closure). If the object is intentionally extensible, describe the extension point
  and constrain it with `patternProperties`.
- Use `null` in a type union only when absence and null have different, intentional
  meanings. A missing property is not the same as a property whose value is null.
- Use `const` for one fixed value and `enum` for a finite set. Give enum values a
  description at the containing field and include representative examples.
- Use `format` for interoperable semantic hints (for example `date-time`), but do
  not rely on a format alone for a business invariant. Add a `pattern`, numeric
  bound, or application rule when required and test the chosen validator's format
  configuration.

### Reuse and references

- Prefer `$defs` plus local references such as `"$ref": "#/$defs/Address"` for
  repeated structures in one document.
- A `$defs` member is a named schema and therefore needs its own `description` and
  `examples` under this skill.
- Keep references resolvable in the repository's actual validation setup. A `$ref`
  to another file requires that the validator loads that file; an `$id` alone does
  not cause network or filesystem retrieval.
- Avoid deep, cyclic composition unless the domain requires it. When using
  `allOf`, `anyOf`, `oneOf`, or conditionals, add examples for each meaningful
  branch and explain discriminator behavior in descriptions.

## Repository schema organization

Repository schema collections SHOULD organize schemas by family and major version:

```text
schemas/
├── <schema-family>/
│   ├── v1/
│   │   └── <schema-file>.schema.json
│   └── v2/
│       └── <schema-file>.schema.json
└── common/
    └── v1/
        └── <shared-schema>.schema.json
```

The family directory identifies the contract family and the `vN` directory
identifies its major version. A family may contain more than one schema file when
the family is a deliberate collection of related contracts, such as delivery
helper schemas. Examples belong beneath the versioned directory that owns them.

`$id` values MUST remain stable and unique in the local registry. Moving a schema
does not by itself require changing its public `$id`; filesystem organization and
public schema identity are separate concerns.

References between files MUST be resolvable in the repository's configured local
schema root. Prefer explicit relative file references for moved repository files:

```json
{ "$ref": "../../common/v1/reference.schema.json#/$defs/Reference" }
```

Use `./sibling.schema.json` for a file in the same version directory. Resolve
relative references from the referencing document's directory, preserve fragments,
and never rely on network retrieval. When a schema collection is nested, the
validator's schema root is the safety boundary; references that escape it MUST be
rejected.

For the repository-local validator, pass the collection root explicitly:

```bash
schema-validate --root sdlc/schemas \
  sdlc/schemas/common/v1/reference.schema.json
```

When a schema is moved, update its relative `$ref` values, examples containing
repository paths, runtime consumers, fixtures, documentation, and validation
commands together. Validate the complete nested tree rather than only the moved
root file.

## Rule contract enforced by `schema-validate`

Each rule has one responsibility and produces stable finding codes. The validator
orchestrates independent rules; it does not let a rule read files, print output, or
choose process exit codes. This keeps rules replaceable and makes each rule directly
unit-testable (SOLID: single responsibility, open/closed extension, dependency
inversion through the rule/context interfaces, and small substitutable contracts).

| Rule | Required behavior | Finding codes |
| --- | --- | --- |
| `root-metadata` | Root is a self-describing JSON Schema with 2020-12 `$schema`, absolute `$id`, `title`, `description`, a supported root `type`, and at least one root example. | `ROOT_NOT_OBJECT`, `MISSING_DIALECT`, `INVALID_ID`, `MISSING_TITLE`, `MISSING_DESCRIPTION`, `MISSING_EXAMPLES`, `ROOT_INVALID_TYPE` |
| `field-documentation` | Every named `properties`, `patternProperties`, and `$defs` schema has a non-empty `description` and a non-empty `examples` array. | `FIELD_MISSING_DESCRIPTION`, `FIELD_MISSING_EXAMPLE` |
| `naming` | Fields are lowerCamelCase and reusable `$defs` names are PascalCase. | `INVALID_FIELD_NAME`, `INVALID_DEFINITION_NAME` |
| `object-contract` | Objects with declared fields have a `required` array, unique required names declared in the object, and an explicit closed boundary. | `MISSING_REQUIRED`, `DUPLICATE_REQUIRED`, `UNKNOWN_REQUIRED`, `OPEN_OBJECT` |
| `examples` | Field/definition example primitive types match their declared `type`; root examples and compiled schemas are validated by Ajv. | `EXAMPLE_TYPE_MISMATCH`, `EXAMPLE_INVALID`, `ROOT_EXAMPLE_INVALID` |

The CLI also reports parser and Ajv failures: `INVALID_JSON`, `FILE_READ_ERROR`,
`ROOT_NOT_OBJECT`, `SCHEMA_META_INVALID`, and `SCHEMA_COMPILE_ERROR`.

## CLI reference

The executable accepts one or more file paths. Paths are read in parallel, but the
report order follows the input order and findings are deterministic.

```bash
# Human-readable diagnostics
schema-validate schemas/user.schema.json

# Validate multiple schemas; all files are reported even if one fails
schema-validate schemas/user.schema.json schemas/error.schema.json

# Stable machine-readable aggregate report for CI or another agent
schema-validate --json --root schemas \
  $(find schemas -type f -name '*.schema.json' -print | sort)

# Validate a JSON instance against one schema, resolving local $refs under the root
schema-validate --root schemas \
  --schema schemas/user/v1/user.schema.json \
  --document fixtures/user.json

# Validate an equivalent YAML instance (.yaml and .yml are supported)
schema-validate --root schemas \
  --schema schemas/user/v1/user.schema.json \
  --document fixtures/user.yaml

# Usage and rule summary
schema-validate --help
schema-validate --version
```

Exit codes:

- `0`: every supplied document passed Ajv and all authoring rules.
- `1`: a schema or instance was unreadable, malformed, invalid, or violated a
  schema/rule constraint.
- `2`: command or argument error, including incomplete or incompatible
  `--schema`/`--document` options.

The positional-file form validates schema documents and applies this skill's
authoring rules. The explicit `--schema`/`--document` form validates one instance
and does not apply authoring rules to the schema. Schema files are always JSON.
Instance files are selected by extension: `.json` uses strict JSON parsing, while
`.yaml` and `.yml` use YAML 1.2 parsing. Exactly one YAML document is accepted;
duplicate keys and unresolved/custom tags are rejected. Network `$ref` retrieval is
never attempted, and local references must remain inside `--root`.

Instance-mode `--json` output contains `valid`, `schema`, `document`, detected
`format` on successful parsing, and structured Ajv `errors` with `instancePath`,
`keyword`, `message`, and `params` fields.

Human output is suitable for a developer. `--json` emits:

```json
{
  "valid": false,
  "reports": [
    {
      "path": "schemas/user.schema.json",
      "valid": false,
      "findings": [
        {
          "code": "FIELD_MISSING_DESCRIPTION",
          "rule": "field-documentation",
          "path": "$.properties.userName.description",
          "message": "Every named field and reusable definition needs a non-empty description.",
          "severity": "error"
        }
      ]
    }
  ]
}
```

When developing this skill package itself:

```bash
mkdir -p "$HOME/src/github"
git clone git@github.com:mchandschuh/json-schema-authoring.git "$HOME/src/github/json-schema-authoring"
cd "$HOME/src/github/json-schema-authoring"
npm ci
npm run typecheck
npm test
npm run build
node ./bin/schema-validate.js --help
```

To perform the complete checkout setup, including dependencies, the compiled
executable in the user-local terminal bin, and the agent skill in the skills
directory, run:

```bash
cd "$HOME/src/github/json-schema-authoring"
./scripts/install_agent_skill.mjs "$HOME/.cline/skills"
```

The installer runs the locked dependency install, builds `dist/`, calls `npm link`,
verifies `$HOME/.local/bin/schema-validate`, and creates links for `SKILL.md` and
`references/` under `$HOME/.cline/skills/json-schema-authoring`. It uses `$HOME/.local`
by default, or `AGENT_NPM_PREFIX` when a different user-local npm prefix is required,
and refuses to overwrite unrelated skill links or files.

## Python-heavy repositories

The design conventions remain language-neutral. If the target repository is mostly
Python, first use its existing test and dependency workflow. The standard fallback
is `jsonschema` with `Draft202012Validator.check_schema()` for schema structure and
`Draft202012Validator.iter_errors(instance)` for examples. Keep the same root
metadata, descriptions, examples, naming, required, and object-closure conventions;
the Python fallback is a validation engine choice, not a relaxation of the contract.

## What not to do

- Do not claim that `description`, `title`, or `examples` affect JSON Schema
  assertion semantics; they are annotations. This skill enforces them as quality
  rules for maintainability.
- Do not use `default` as a validator-side fill operation. Defaults are annotations
  unless an application explicitly applies them.
- Do not silently change a public field name or requiredness to make a fixture pass.
  Update the contract, fixture, and migration notes together.
- Do not put credentials, access tokens, production personal data, or other secrets
  in examples.
- Do not report only that a schema parses. Run the CLI, inspect all findings, and
  test representative instances when the schema governs an API or persisted data.

## Research basis

The companion research notes in `references/research.md` record the sources used for
this skill. The instruction-writing structure follows recurring guidance from OpenAI,
Anthropic, and Google: be clear and specific, provide context and examples, decompose
complex work, use explicit tool/validation steps, and evaluate outputs against stated
criteria. JSON Schema conventions follow the JSON Schema documentation and
specification; Ajv-specific implementation details follow Ajv's documentation.
