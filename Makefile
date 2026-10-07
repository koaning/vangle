.PHONY: all docs site test serve pr

# Rebuild the docs and run the tests.
all: docs test

# Generate docs/*.html from docs/*.md. The HTML is gitignored.
docs:
	node site/build.js

# Assemble the site that GitHub Pages publishes in _site/.
site: docs
	rm -rf _site && mkdir -p _site/docs _site/site
	cp index.html tangle.js tangle.css llms.txt _site/
	cp docs/*.html docs/*.md _site/docs/
	cp site/site.css site/site.js site/favicon.svg _site/site/

test:
	node --test

# Serve the site at http://localhost:8000 (or another port: make serve PORT=8080).
PORT ?= 8000
serve:
	python3 -m http.server $(PORT)

# Test, then push the current branch and open a pull request against main,
# filled in from the commits. Commit your work first.
pr: test
	@test "$$(git branch --show-current)" != main || { echo "On main: create a branch first."; exit 1; }
	@test -z "$$(git status --porcelain)" || { git status --short; echo "Uncommitted changes. Commit them first."; exit 1; }
	git push -u origin HEAD
	@gh pr view --json url -q "\"Already open: \" + .url" 2>/dev/null || gh pr create --base main --fill
