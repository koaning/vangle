.PHONY: all docs test serve pr

# Rebuild the docs and run the tests.
all: docs test

# Generate docs/*.html from docs/*.md.
docs:
	node site/build.js

test:
	node --test

# Serve the site at http://localhost:8000 (or another port: make serve PORT=8080).
PORT ?= 8000
serve:
	python3 -m http.server $(PORT)

# Rebuild and test, then push the current branch and open a pull request
# against main, filled in from the commits. Commit your work first.
pr: docs test
	@test "$$(git branch --show-current)" != main || { echo "On main: create a branch first."; exit 1; }
	@test -z "$$(git status --porcelain)" || { git status --short; echo "Uncommitted changes (the docs build may have made some). Commit them first."; exit 1; }
	git push -u origin HEAD
	@gh pr view --json url -q "\"Already open: \" + .url" 2>/dev/null || gh pr create --base main --fill
