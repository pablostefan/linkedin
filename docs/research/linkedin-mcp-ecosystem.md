# LinkedIn MCP Ecosystem — Pesquisa

> Última atualização: 2025-04-07
> Contexto: levantamento de MCP servers, agentes e plugins focados em LinkedIn disponíveis no GitHub.

## Panorama

- **219+ repositórios** no GitHub relacionados a LinkedIn MCP servers
- Ecossistema ativo mas fragmentado — não existe um hub centralizado tipo "awesome-copilot" para LinkedIn
- A maioria foca em scraping/leitura; poucos cobrem publicação

## Repos Relevantes

### 1. stickerdaniel/linkedin-mcp-server

| Campo | Valor |
|:------|:------|
| URL | https://github.com/stickerdaniel/linkedin-mcp-server |
| Stars | 1.299 |
| Linguagem | Python |
| Versão | v4.8.2 (41 releases) |
| Licença | Apache-2.0 |
| Instalação | `uvx linkedin-scraper-mcp@latest` |

**Foco:** scraping e leitura de dados do LinkedIn via Patchright (browser automation com persistent profiles).

**Tools disponíveis:**
- `get_person_profile` (com seleção de seções: experience, education, interests, honors, languages, certifications, contact_info, posts)
- `get_sidebar_profiles`
- `connect_with_person`
- `get_company_profile`
- `get_company_posts`
- `search_people`
- `search_jobs`
- `get_job_details`
- `get_inbox`
- `get_conversation`
- `search_conversations`
- `send_message`
- `close_session`

**Avaliação:** o mais popular e maduro. Não publica posts. Complementa o pipeline de publicação via Zernio com capacidades de leitura/pesquisa que não temos.

---

### 2. timkulbaev/mcp-linkedin

| Campo | Valor |
|:------|:------|
| URL | https://github.com/timkulbaev/mcp-linkedin |
| Stars | 1 |
| Linguagem | JavaScript (Node.js 18+, ES modules) |
| Versão | v1.0.0 |
| Licença | MIT |
| Instalação | `node /path/to/index.js` |

**Foco:** publicação de posts via Unipile API.

**Tools disponíveis:**
- `linkedin_publish` — cria post com texto, media attachments, @mentions de empresas
- `linkedin_comment` — comenta num post existente
- `linkedin_react` — reage a um post

**Destaques:**
- Dry-run por default (não publica sem confirmação)
- Auto-like após publicar
- 28 unit tests, zero dependencies
- Stack idêntico ao nosso projeto (Node.js 18+, ES modules, node:test)

**Avaliação:** sobreposição direta com o que o Zernio CLI faz. Interessante como referência de arquitetura mas não adiciona valor ao workflow atual. Requer conta Unipile (tem free tier).

---

### 3. sigvardt/linkedin-buddy

| Campo | Valor |
|:------|:------|
| URL | https://github.com/sigvardt/linkedin-buddy |
| Stars | 1 |
| Linguagem | TypeScript |
| Versão | Sem releases |
| Licença | — |
| Instalação | Monorepo (`@linkedin-buddy/mcp`) |

**Foco:** automação completa do LinkedIn com 100+ MCP tools.

**Capacidades:**
- Feed: listar, visualizar, comentar, reagir
- Posts: criar com two-phase commit (prepare, review, confirm)
- Inbox: mensagens, conversas
- Jobs: pesquisa e detalhes
- Search: pessoas, empresas
- Notifications: polling, webhooks
- Newsletters e artigos

**Destaques:**
- Três superfícies: CLI + MCP Server + TypeScript API
- Anti-bot evasion: digitação humana, delays Poisson, movimentos Bézier, fingerprint hardening
- Local-first: SQLite, persistent Playwright profiles, zero telemetria
- 25+ services via constructor injection

**Avaliação:** extremamente ambicioso e bem documentado. Imaturo (0 releases, 1 star). Monorepo TypeScript com Node.js 22+. Poderia ser valioso no futuro para funcionalidades de leitura/engajamento.

---

### 4. Linked-API/linkedapi-mcp

| Campo | Valor |
|:------|:------|
| URL | https://github.com/Linked-API/linkedapi-mcp |
| Stars | 45 |
| Linguagem | TypeScript |
| Versão | v0.3.6 |
| Licença | MIT |
| Instalação | Via linkedapi.io |

**Foco:** automação via cloud browser (linkedapi.io).

**Use cases:** sales automation, recruitment, conversation management, market research.

**Avaliação:** wrapper de serviço comercial. Foco em vendas/recrutamento. Menos relevante para criação de conteúdo.

---

### Outros repos notáveis

| Repo | Stars | Linguagem | Foco |
|:-----|:------|:----------|:-----|
| adhikasp/mcp-linkedin | 197 | Python | Feeds e Job API |
| eliasbiondo/linkedin-mcp-server | 131 | Python | Pesquisa de pessoas, empresas, vagas |
| Sharan-Kumar-R/Custom-MCP-Server | 73 | Python | Scraping multi-plataforma |
| anysiteio/anysite-mcp-server | 59 | JavaScript | LinkedIn via Anysite API |
| felipfr/linkedin-mcpserver | 54 | TypeScript | Integração com LinkedIn API |

## Análise de Gaps

| O que o workflow atual cobre (Zernio) | O que falta |
|:--------------------------------------|:------------|
| Publicação de posts (text, article, image) | Leitura de perfis de terceiros |
| Draft lifecycle (create, update, prepare, confirm) | Pesquisa de concorrentes |
| Analytics e histórico | Análise de posts de empresas |
| Mention resolution (person URN) | Dados de rede (conexões, inbox) |
| 13 agentes especializados para editorial | Monitoramento de feed |

## Recomendação

O **stickerdaniel/linkedin-mcp-server** é o candidato mais viável para complementar o pipeline:

- Preenche gaps reais (leitura de perfis, posts de empresas, pesquisa)
- Mais maduro (1.299 stars, 41 releases, 18 contributors)
- Instalação simples via `uvx`
- Não conflita com Zernio (leitura vs publicação)

### Configuração sugerida para `.vscode/mcp.json`

```json
{
  "servers": {
    "linkedin-scraper": {
      "command": "uvx",
      "args": ["linkedin-scraper-mcp@latest"],
      "env": {
        "UV_HTTP_TIMEOUT": "300"
      }
    }
  }
}
```

### Possíveis usos com os agentes existentes

- **LinkedIn Editorial Memory**: enriquecer com dados de posts de concorrentes via `get_company_posts`
- **LinkedIn Performance Coach**: benchmark contra perfis similares via `get_person_profile`
- **LinkedIn Topic Interviewer**: contexto de mercado via `search_people` e `search_jobs`
- **LinkedIn Duplicate Guard**: comparar com posts de terceiros, não só os próprios
