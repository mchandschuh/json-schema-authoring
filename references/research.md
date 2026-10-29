# JSON Schema Authoring Skill Research

Research was completed on 2026-10-14. Sources are grouped by authority. Provider
prompting guidance is used for the shape of this skill (clear instructions,
examples, decomposition, explicit validation, and evaluation); it is not presented
as JSON Schema authority.

## LLM instruction and skill-writing guidance

### OpenAI — Prompt engineering

Source: <https://platform.openai.com/docs/guides/prompt-engineering>

Actionable patterns used here:

- Make instructions clear and specific rather than relying on implied intent.
- For agentic coding work, decompose the request, plan thoroughly, use clear
  preambles for major tool decisions, track work, and persist until all requested
  parts are resolved.
- Ask the model to test changes and validate patches; include concrete tool-use
  examples because examples improve reliability and adherence.
- Define standards for clean Markdown and make paths, functions, and classes easy to
  identify. This skill therefore uses headings, tables, fenced examples, exact paths,
  and explicit commands.
- For larger codebases, state structure, reusable components, integration boundaries,
  assumptions, and verification requirements. This skill separates rule modules,
  orchestration, CLI output, and tests.

### Anthropic — Prompt engineering overview and best practices

Sources:

- <https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview>
- <https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompting-best-practices>

Actionable patterns used here:

- Establish success criteria and ways to empirically test them before refining
  instructions. The rule table and unit tests make success observable.
- Use clear, direct instructions and organize long instructions into explicit
  sections. This skill separates workflow, canonical shape, conventions, rules,
  CLI reference, fallback behavior, and anti-patterns.
- Supply examples where output shape or behavior could otherwise be ambiguous.
  The skill includes a canonical schema, CLI commands, JSON output, and rule table.
- Give the agent relevant context and constraints, then decompose complex tasks into
  steps. The workflow requires repository inspection, contract research, authoring,
  validation, testing, and review.

### Google — Prompt design strategies

Source: <https://ai.google.dev/gemini-api/docs/prompting-strategies>

Actionable patterns used here:

- Prompt design is iterative; treat recommendations as starting points and refine
  against observed results.
- Use clear, specific instructions, include relevant context, provide few-shot or
  concrete examples, and break complex requests into smaller steps.
- Include a verification step rather than assuming that a plausible output is
  correct. The workflow requires CLI validation, unit tests, and diff review.

## JSON Schema authority

### JSON Schema annotations

Source: <https://json-schema.org/understanding-json-schema/reference/annotations.html>

The documentation describes `title` as short, `description` as a longer explanation,
and `examples` as an array intended to help explain the schema. It also notes that
these annotation keywords are not themselves required for validation and that
examples should validate against the schema, although the specification does not
make that a validation assertion. This skill intentionally makes descriptions and
examples mandatory quality rules while explaining that distinction to agents.

### JSON Schema objects

Source: <https://json-schema.org/understanding-json-schema/reference/object.html>

The official guide explains that `properties` defines schemas for named values but
does not make properties required; `required` is a separate array. It also explains
that additional properties are allowed by default and must be constrained explicitly.
Those details directly motivate the `object-contract` rule and the required/closure
conventions in `SKILL.md`.

### Schema organization and references

Source: <https://json-schema.org/understanding-json-schema/structuring.html>

The official guide recommends structuring schemas into reusable components, explains
that `$id` supplies a base URI/identifier, and describes `$defs` and references for
reuse. It also cautions that identifiers are not automatically fetched from the
network or filesystem. The skill therefore prefers local `$defs`, stable absolute
identifiers, and a repository-specific reference-loading policy.

### JSON Schema 2020-12 core specification

Source: <https://json-schema.org/draft/2020-12/json-schema-core>

The specification defines schema documents, dialects/vocabularies, identifiers,
references, applicators, assertions, and annotations. The implementation targets the
2020-12 dialect and delegates standard assertion behavior to Ajv rather than trying
to reimplement the specification in custom rules.

## Validator implementation authority

### Ajv schema-language guide

Source: <https://ajv.js.org/guide/schema-language.html>

Ajv documents support for draft-2020-12 through its dedicated 2020 export and notes
that strict mode helps catch authoring mistakes. The implementation uses Ajv's
2020-12 class, compiles schemas, validates root examples, and exposes structured
errors while keeping descriptive policy rules separate from standard JSON Schema
assertions.

## Forum and community search result

The requested forum search was attempted, but Stack Overflow returned HTTP 403 for
the relevant JSON Schema questions and Reddit's JSON Schema page returned only a
shell page without readable discussion content. No forum claim is therefore treated
as evidence in this skill. The Stack Exchange API query also returned an empty item
list. A public GitHub issue search was accessible and showed active discussion around
`unevaluatedProperties` across `oneOf` branches, proposals for undefined-property
keywords, and the long-running question of optional/required complements; those
topics reinforce that object closure and composition need an explicit project policy,
but issue-list themes are community discussion, not normative behavior. See the
search at <https://github.com/json-schema-org/json-schema-spec/issues?q=is%3Aissue+is%3Aopen+additionalProperties>.
The practical conventions that might normally be checked against forum consensus are
therefore grounded here in the official JSON Schema documentation, the specification,
Ajv documentation, the accessible GitHub discussion themes, and the repository's
existing CLI conventions.

## Local repository authority

The implementation follows the project's Node.js CLI and SDLC package conventions
for TypeScript, native ESM, explicit `.js` imports, deterministic command discovery,
small executable shims, Vitest tests, package shape, and test style. It also follows
the requested `npm link` registration workflow for the public `schema-validate`
executable.