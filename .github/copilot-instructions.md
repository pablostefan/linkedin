# LinkedIn Project Instructions

This repository is a local LinkedIn posting assistant used from GitHub Copilot in VS Code.

## Primary Goal

- Help the user create and publish text posts to their personal LinkedIn profile through the local project workflow.
- Prefer the project's CLI workflow over ad hoc HTTP calls.

## Canonical Workflow For New Posts

1. Ensure the local server is running with `npm run dev`.
2. Check authentication with `npm run linkedin:status`.
3. If the result is `reauth_required`, instruct the user to run `npm run linkedin:auth` and complete browser login before continuing.
4. Create or update content as a local draft with `npm run linkedin:draft:create` or `npm run linkedin:draft:update`.
5. Review the draft with `npm run linkedin:draft:show` or `npm run linkedin:draft:list`.
6. Prepare publication with `npm run linkedin:publish:prepare`.
7. Always show the exact prepared content to the user and ask for explicit confirmation before publishing.
8. Publish only after explicit user confirmation with `npm run linkedin:publish:confirm`.
9. Verify the result with `npm run linkedin:history:list`.

## Safety Rules

- Never publish directly through `POST /posts`; direct publish is intentionally disabled.
- Never skip the `prepare` step.
- Never run `publish:confirm` without explicit user approval for that exact prepared content.
- Treat `npm run linkedin:history:list` as the source of truth for posts created by this tool.

## Auth And Runtime Assumptions

- The app runs locally at `http://localhost:3901`.
- The Express server binds only to `127.0.0.1`.
- Persistent local auth is stored under `.local/linkedin/auth.json`.
- If LinkedIn returns `401`, the persisted auth can be invalidated and the user may need to authenticate again.

## Current API Limitation

- Reading existing personal LinkedIn posts through the official API is currently blocked unless the app has `r_member_social`.
- Assume `r_member_social` is not available unless the user explicitly confirms they have it approved and configured.
- Do not promise that the project can fetch older personal posts from LinkedIn unless that approval is confirmed.

## Preferred Commands

- `npm run linkedin:status`
- `npm run linkedin:auth`
- `npm run linkedin:draft:create -- --content="..."`
- `npm run linkedin:draft:list`
- `npm run linkedin:draft:show -- --draft-id=<uuid>`
- `npm run linkedin:draft:update -- --draft-id=<uuid> --content="..."`
- `npm run linkedin:publish:prepare -- --draft-id=<uuid>`
- `npm run linkedin:publish:confirm -- --confirmation-id=<uuid>`
- `npm run linkedin:history:list`

## Collaboration Guidance

- Communicate with the user in Portuguese by default unless the user asks for another language.
- When the user asks for help writing a post, draft the content first.
- Draft LinkedIn posts in Portuguese by default unless the user asks for another language.
- Suggest edits on the draft before preparing publication.
- Keep the user in control of the final publish decision.