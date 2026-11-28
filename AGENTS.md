# Project Rules

## Automatic Commit & Deploy

- After completing code changes in this repository and verifying `npm run build` (and relevant tests), automatically commit the changes with a concise commit message and push to `origin main` to trigger deployment to GitHub Pages (`.github/workflows/pages.yml`), unless the user explicitly asks not to commit or deploy.
- If `firestore.rules` or `firestore.indexes.json` were modified, also run `npm run deploy:rules` (and report clearly if deployment requires re-authentication).
