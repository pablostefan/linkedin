# AGENTS

This repository is a local LinkedIn posting workflow for GitHub Copilot in VS Code.

## Architecture

The system uses **specialist agents** coordinated by a thin routing orchestrator. Each agent has one clear responsibility. The orchestrator (`LinkedIn Publishing Orchestrator`) only detects phases and delegates.

## Specialist Agents

| Agent | File | Responsibility |
|:------|:-----|:---------------|
| LinkedIn Publishing Orchestrator | `.github/agents/linkedin-publishing-orchestrator.agent.md` | Routing-only orchestrator. Detects phase, picks agent, passes results. |
| LinkedIn Topic Interviewer | `.github/agents/linkedin-topic-interviewer.agent.md` | Clarifica tema, objetivo, audiência, ângulo e tom. Retorna creative brief. |
| LinkedIn Editorial Memory | `.github/agents/linkedin-editorial-memory.agent.md` | Contexto histórico: temas cobertos, ângulos usados, gaps de conteúdo, cadência, performance. |
| LinkedIn Post Critic | `.github/agents/linkedin-post-critic.agent.md` | Revisão editorial: hook, CTA, length, valor, repetição. |
| LinkedIn Hook Optimizer | `.github/agents/linkedin-hook-optimizer.agent.md` | Avalia e otimiza hooks. Score, alternativas por tipo, análise de especificidade e tensão. |
| LinkedIn Voice Validator | `.github/agents/linkedin-voice-validator.agent.md` | Valida voz do autor: emojis, travessões, tom, filler corporativo, drift estilístico, voice fingerprint. |
| LinkedIn Fact Checker | `.github/agents/linkedin-fact-checker.agent.md` | Verifica claims factuais: dados numéricos, precisão técnica, atribuições, atualidade. |
| LinkedIn Performance Coach | `.github/agents/linkedin-performance-coach.agent.md` | Analisa performance histórica e recomenda formato, tamanho, tipo de hook e timing. |
| LinkedIn Format Strategist | `.github/agents/linkedin-format-strategist.agent.md` | Decide formato: text-only, article-preview, ou single-image. |
| LinkedIn Visual Briefing | `.github/agents/linkedin-visual-briefing.agent.md` | Briefing visual e prompt para geração de imagem. |
| LinkedIn Duplicate Guard | `.github/agents/linkedin-duplicate-guard.agent.md` | Verifica duplicatas: similarity scoring, hook fingerprint, theme clustering, engagement-weighted recency. |
| LinkedIn Preview QA | `.github/agents/linkedin-preview-qa.agent.md` | Valida rendering: OG metadata, dimensões de imagem, limites de caracteres, integridade do draft. |
| LinkedIn Draft Manager | `.github/agents/linkedin-draft-manager.agent.md` | Executa operações CLI: criar/atualizar rascunho, prepare, confirm, history. |

External agents (not in this repo): `reepl-linkedin` (copy generation), `gem-critic` (strategic challenge), `gem-designer` (visual asset critique), `Explore` (context gathering).

## What Agents Should Do

- Communicate in Portuguese by default unless the user asks for another language.
- Draft LinkedIn posts in Portuguese by default.
- Use the project CLI to create, review, prepare, and publish posts.
- Default to draft-first behavior for any new post request.
- Require explicit user confirmation before `publish:confirm`.

## Post Workflow

1. Check Zernio connectivity: `npm run linkedin:status`. If it fails, verify config with `npx zernio status`.
2. Create or update draft: `npm run linkedin:draft:create` or `npm run linkedin:draft:update`
5. Use article-preview flags when the post should render a link card: `--article-source`, `--article-title`, `--article-description`
6. Use image flags when the post should attach a single image: `--image-path`, optional `--image-alt`
7. Inspect draft: `npm run linkedin:draft:show` or `npm run linkedin:draft:list`
8. Prepare publish: `npm run linkedin:publish:prepare`
9. Ask user to confirm the exact prepared text
10. Confirm publish: `npm run linkedin:publish:confirm`
11. Verify result: `npm run linkedin:history:list`

## Constraints

- Publishing and analytics are handled by Zernio CLI (`npx zernio`). Config at `~/.zernio/config.json`.
- Do not use direct `POST /posts` for publishing
- Do not assume existing personal posts can be fetched from LinkedIn
- Existing-post retrieval requires `r_member_social`, which should be considered unavailable unless the user confirms otherwise
- Person mentions in posts use LinkedIn little text in `commentary`, for example `@[Nome](urn:li:person:...)`
- Profile URL to person URN resolution is available via `npm run linkedin:mention:resolve -- --url="URL"` or Zernio's resolver endpoint

## Local Data

- Drafts: `.local/linkedin/drafts.json`
- History: `.local/linkedin/publish-history.jsonl`
- Rich posts: draft payloads can now include article preview metadata or a single image attachment