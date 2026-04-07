# LinkedIn Project Instructions

This repository is a local LinkedIn posting assistant used from GitHub Copilot in VS Code.

## Primary Goal

- Help the user create and publish text posts to their personal LinkedIn profile through the local project workflow.
- Prefer the project's CLI workflow over ad hoc HTTP calls.

## Canonical Workflow For New Posts

1. Verify Zernio connectivity with `npm run linkedin:status`. If it fails, instruct the user to check Zernio config with `npx zernio status`.
2. Create or update content as a local draft with `npm run linkedin:draft:create` or `npm run linkedin:draft:update`.
5. If the post should have a link preview, create it as an article post by passing `--article-source`, `--article-title`, and `--article-description`.
6. If the post should have a single image, pass `--image-path` and optional `--image-alt`.
7. Review the draft with `npm run linkedin:draft:show` or `npm run linkedin:draft:list`.
8. Prepare publication with `npm run linkedin:publish:prepare`.
9. Always show the exact prepared content to the user and ask for explicit confirmation before publishing.
10. Publish only after explicit user confirmation with `npm run linkedin:publish:confirm`.
11. Verify the result with `npm run linkedin:history:list`.

## Safety Rules

- Never publish directly through `POST /posts`; direct publish is intentionally disabled.
- Never skip the `prepare` step.
- Never run `publish:confirm` without explicit user approval for that exact prepared content.
- Treat `npm run linkedin:history:list` as the source of truth for posts created by this tool.
- For published post content and analytics, use `.local/linkedin/zernio-posts.json` (synced via `npm run linkedin:posts:sync`).

## Zernio Backend

- Publishing and analytics are handled by Zernio CLI (`npx zernio`).
- Zernio config is stored at `~/.zernio/config.json`.
- The project does not run a local server. All LinkedIn API interaction goes through Zernio.
- If Zernio returns an auth or connectivity error, instruct the user to verify config with `npx zernio status`.

## Preferred Commands

- `npm run linkedin:status`
- `npm run linkedin:draft:create -- --content="..."`
- `npm run linkedin:draft:create -- --content="..." --article-source="https://..." --article-title="..." --article-description="..."`
- `npm run linkedin:draft:create -- --content="..." --image-path="/abs/path/image.png" --image-alt="..."`
- `npm run linkedin:draft:list`
- `npm run linkedin:draft:show -- --draft-id=<uuid>`
- `npm run linkedin:draft:update -- --draft-id=<uuid> --content="..."`
- `npm run linkedin:publish:prepare -- --draft-id=<uuid>`
- `npm run linkedin:publish:confirm -- --confirmation-id=<uuid>`
- `npm run linkedin:history:list`
- `npm run linkedin:analytics -- --days=<n>`
- `npm run linkedin:mention:resolve -- --url="https://linkedin.com/in/..."`
- `npm run linkedin:posts:sync`

## Collaboration Guidance

- Communicate with the user in Portuguese by default unless the user asks for another language.
- When the user asks for help writing a post, draft the content first.
- Draft LinkedIn posts in Portuguese by default unless the user asks for another language.
- Suggest edits on the draft before preparing publication.
- Keep the user in control of the final publish decision.
- For technical posts, keep the copy concise and practical. Prefer one concrete takeaway over a feature list.
- If the user says the draft is too long or massante, tighten aggressively before suggesting new ideas.
- Avoid reintroducing phrases the user explicitly rejected in the current conversation.

## Agent Architecture

This project uses specialist agents coordinated by a routing orchestrator. For LinkedIn post workflows, prefer the `LinkedIn Publishing Orchestrator` which delegates to:

| Agent | Role |
|:------|:-----|
| LinkedIn Topic Interviewer | Clarificação de tema, objetivo e ângulo |
| LinkedIn Editorial Memory | Contexto histórico: temas cobertos, ângulos usados, gaps de conteúdo, cadência, performance |
| reepl-linkedin | Geração de copy |
| LinkedIn Post Critic | Revisão editorial |
| LinkedIn Hook Optimizer | Avalia e otimiza hooks. Score, alternativas por tipo, análise de especificidade e tensão |
| LinkedIn Voice Validator | Valida voz do autor: emojis, travessões, tom, filler corporativo, drift estilístico, voice fingerprint |
| LinkedIn Fact Checker | Verifica claims factuais: dados numéricos, precisão técnica, atribuições, atualidade |
| LinkedIn Performance Coach | Analisa performance histórica e recomenda formato, tamanho, tipo de hook e timing |
| LinkedIn Format Strategist | Decisão de formato (text/article/image) |
| LinkedIn Visual Briefing | Briefing visual e prompt de imagem |
| LinkedIn Duplicate Guard | Verificação de duplicatas: similarity scoring, hook fingerprint, theme clustering, engagement-weighted recency |
| LinkedIn Preview QA | Valida rendering: OG metadata, dimensões de imagem, limites de caracteres, integridade do draft |
| LinkedIn Draft Manager | Operações CLI (draft, prepare, confirm) |