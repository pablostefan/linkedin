# AGENTES

Este repositório é um workflow local de publicação no LinkedIn para GitHub Copilot no VS Code.

## Arquitetura

O sistema gerencia o ciclo completo de posts no LinkedIn: planejamento (Post Planner), pesquisa de tendências (Trend Researcher), criação de conteúdo (Post Editor), crítica (Post Critic), operações CLI (Draft Manager) e publicação via Zernio.

## Agentes

| Agente | Arquivo | Responsabilidade |
|:-------|:--------|:-----------------|
| LinkedIn Publishing Orchestrator | `.github/agents/linkedin-publishing-orchestrator.agent.md` | Ponto de entrada para publicar posts. Coordena o fluxo delegando para os agentes especialistas. |
| LinkedIn Post Planner | `.github/agents/linkedin-post-planner.agent.md` | Planejar estratégia, estrutura, hook, CTA e formato do post antes da redação. |
| LinkedIn Post Editor | `.github/agents/linkedin-post-editor.agent.md` | Colaborar interativamente com o usuário para criar ou refinar o texto do post. |
| LinkedIn Post Critic | `.github/agents/linkedin-post-critic.agent.md` | Avaliar qualidade, engajamento, profundidade, tom e autenticidade do post. |
| LinkedIn Trend Researcher | `.github/agents/linkedin-trend-researcher.agent.md` | Pesquisar posts de destaque no LinkedIn sobre um tema e usar como base para criar um novo post. |
| LinkedIn Draft Manager | `.github/agents/linkedin-draft-manager.agent.md` | Executa operações CLI: criar/atualizar rascunho, prepare, confirm, history. |

## O Que os Agentes Devem Fazer

- Comunicar em português por padrão, salvo pedido de outro idioma.
- Usar o CLI do projeto para criar, preparar e publicar posts.
- O Post Editor pode auxiliar na criação e refinamento do texto, mas o usuário SEMPRE tem a decisão final.
- Exigir confirmação explícita do usuário antes de `publish:confirm`.

## Workflow de Publicação

1. Verificar conectividade Zernio: `npm run linkedin:status`. Se falhar, verificar configuração com `npx zernio status`.
2. Criar ou atualizar rascunho: `npm run linkedin:draft:create` ou `npm run linkedin:draft:update`
5. Usar flags de article-preview quando o post deve renderizar um link card: `--article-source`, `--article-title`, `--article-description`
6. Usar flags de imagem quando o post deve anexar uma imagem: `--image-path`, opcional `--image-alt`
7. Inspecionar rascunho: `npm run linkedin:draft:show` ou `npm run linkedin:draft:list`
8. Preparar publicação: `npm run linkedin:publish:prepare`
9. Pedir ao usuário para confirmar o texto preparado exato
10. Confirmar publicação: `npm run linkedin:publish:confirm`
11. Verificar resultado: `npm run linkedin:history:list`

### Posts Agendados

Para agendar um post para publicação futura, passar `--scheduled-for` (datetime ISO 8601) e opcionalmente `--timezone` (timezone IANA, padrão "UTC") no passo de prepare:

```bash
npm run linkedin:publish:prepare -- --draft-id=<uuid> --scheduled-for="2025-07-01T09:00:00Z" --timezone="America/Sao_Paulo"
```

O passo de confirm detecta automaticamente o agendamento e envia `publishNow: false` ao Zernio com os campos de agendamento. O registro no histórico grava `scheduledFor` e `timezone` para auditoria.

### Menções (@mention) em Posts

Menções clicáveis de pessoa e empresa exigem 2 passos:

1. **Resolver URL → mentionFormat**: `npm run linkedin:mention:resolve -- --url="https://linkedin.com/in/slug/"` retorna `displayName`, `urn` e `mentionFormat`
2. **Embeddar mentionFormat no conteúdo**: incluir o `mentionFormat` retornado diretamente no texto do post (ex: `@[Nome Exato](urn:li:person:ID)`)

**Regras críticas:**
- O `displayName` DEVE ser o nome exato do perfil LinkedIn (ex: "Mateus Pereira, CFP®", não "Mateus Pereira"). Nomes inexatos viram texto puro silenciosamente.
- SEMPRE usar o `mentionFormat` retornado pela API de resolução, nunca montar manualmente.
- O campo `mentions` da API Zernio `POST /v1/posts` é apenas referência e NÃO cria menções no LinkedIn.
- Formatos válidos: `@[Nome](urn:li:person:ID)` para pessoas, `@[Empresa](urn:li:organization:ID)` para empresas.
- `urn:li:member:ID` NÃO funciona para menções (HTTP 400).

## Restrições

- Publicação e analytics são gerenciados pelo Zernio CLI (`npx zernio`). Configuração em `~/.zernio/config.json`.
- Não usar `POST /posts` direto para publicar
- Não assumir que posts pessoais existentes podem ser buscados do LinkedIn
- Posts publicados são sincronizados localmente via `npm run linkedin:posts:sync` (armazenados em `.local/linkedin/zernio-posts.json`). Rodar sync antes de usar agentes que dependem do histórico de posts

## Dados Locais

- Rascunhos: `.local/linkedin/drafts.json`
- Posts publicados: `.local/linkedin/zernio-posts.json` (sincronizado via `npm run linkedin:posts:sync`)
- Histórico: `.local/linkedin/publish-history.jsonl` (log local de publicações)
- Posts ricos: payloads de rascunho podem incluir metadados de article preview ou anexo de imagem