# Versioned Schemas

JSON Schemas under this directory are canonical protocol and project contracts. Phase 0 includes:

- Project manifest
- Asset manifest
- Reference manifest
- Deterministic scenarios
- Frame inspection snapshots
- Immutable build records
- Common API error envelopes

Run `npm run schemas:generate` after changing a schema and commit the generated TypeScript files.
Valid and invalid fixtures are tested with strict Ajv 2020 validation.
