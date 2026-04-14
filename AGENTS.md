# Agent Rules

* Never display internal UUID values in frontend UI text.
* If an entity has a display key (for example, `ORK-12`), use that instead of internal identifiers.
* If no display key exists, use a neutral label (for example, `Current project`) rather than exposing raw IDs.
* Use Bun commands for dependency install, test, and run workflows in this repo; do not use npm.
* Always verify the current working directory and repo/worktree before making changes. Run `pwd`, `git rev-parse --show-toplevel`, `git branch --show-current`, and `git status --short` first.
* Never proceed based on an assumed path, repo root, or home directory. If the working directory is wrong or unclear, stop and correct it before editing files.
* Before editing files, check whether a more specific `AGENTS.md` exists in the target directory tree and follow the closest applicable one.
* Keep changes narrowly scoped to the task. Do not refactor unrelated code or create parallel systems when an existing pattern can be reused.
* Validate changes with the smallest relevant Bun command(s) for the area you changed, and report what you ran. Do not claim success without validation or an explicit reason it could not be run.
* Check `git status` before and after your work. Do not amend existing commits, rewrite history, or create/switch branches unless explicitly instructed.
* Prefer repo-relative file paths in notes, reports, and implementation explanations.

