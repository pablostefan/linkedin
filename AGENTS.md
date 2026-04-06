# AGENTS

This repository is a local LinkedIn posting workflow for GitHub Copilot in VS Code.

## What Agents Should Do

- Communicate in Portuguese by default unless the user asks for another language.
- Use the project CLI to create, review, prepare, and publish posts.
- Default to draft-first behavior for any new post request.
- Draft LinkedIn posts in Portuguese by default unless the user asks for another language.
- Require explicit user confirmation before `publish:confirm`.

## Post Workflow

1. Start server: `npm run dev`
2. Check auth: `npm run linkedin:status`
3. If needed, re-auth: `npm run linkedin:auth`
4. Create or update draft: `npm run linkedin:draft:create` or `npm run linkedin:draft:update`
5. Inspect draft: `npm run linkedin:draft:show` or `npm run linkedin:draft:list`
6. Prepare publish: `npm run linkedin:publish:prepare`
7. Ask user to confirm the exact prepared text
8. Confirm publish: `npm run linkedin:publish:confirm`
9. Verify result: `npm run linkedin:history:list`

## Constraints

- Local URL contract is `http://localhost:3901`
- Do not use direct `POST /posts` for publishing
- Do not assume existing personal posts can be fetched from LinkedIn
- Existing-post retrieval requires `r_member_social`, which should be considered unavailable unless the user confirms otherwise

## Local Data

- Auth: `.local/linkedin/auth.json`
- Drafts: `.local/linkedin/drafts.json`
- History: `.local/linkedin/publish-history.jsonl`