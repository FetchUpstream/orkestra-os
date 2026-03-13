# Agent Rules

- Never display internal UUID values in frontend UI text.
- If an entity has a display key (for example, `ORK-12`), use that instead of internal identifiers.
- If no display key exists, use a neutral label (for example, `Current project`) rather than exposing raw IDs.
- Use Bun commands for dependency install, test, and run workflows in this repo; do not use npm.
