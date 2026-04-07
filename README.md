# LinkedIn Zernio Workflow

Assistente local de publicacao no LinkedIn via GitHub Copilot no VS Code.
Toda a interacao com a API do LinkedIn passa pelo Zernio CLI. O projeto nao roda servidor,
nao usa OAuth direto e nao abre navegador.

## Pre-requisitos

| Ferramenta | Versao minima |
|:-----------|:-------------|
| Node.js | 18 |
| npm | Bundled com Node 18+ |
| Zernio CLI | 0.3.0 (`npm install -g @zernio/cli`) |

O Zernio precisa estar configurado com conta e API key antes de usar o projeto.
Verifique com `npx zernio status`. A configuracao fica em `~/.zernio/config.json`.

## Instalacao

```bash
npm install
```

Nao ha servidor para iniciar. Todos os comandos rodam diretamente via CLI.

## Verificar conectividade

```bash
npm run linkedin:status
```

Retorna o estado da conta Zernio e a conexao com o LinkedIn. Se falhar, verifique a config com `npx zernio status`.

## Fluxo canonico de publicacao

1. Verificar conectividade: `npm run linkedin:status`
2. Criar rascunho: `npm run linkedin:draft:create -- --content="Texto do post"`
3. Revisar rascunho: `npm run linkedin:draft:show -- --draft-id=<uuid>`
4. Preparar publicacao: `npm run linkedin:publish:prepare -- --draft-id=<uuid>`
5. Confirmar publicacao: `npm run linkedin:publish:confirm -- --confirmation-id=<uuid>`
6. Verificar resultado: `npm run linkedin:history:list`

Regras de seguranca:

- Nunca publicar sem passar pelo `prepare` + `confirm`.
- Nunca rodar `publish:confirm` sem aprovacao explicita do usuario.
- O fluxo de confirmacao expira em 10 minutos.

## Comandos disponiveis

### Status

```bash
npm run linkedin:status
```

### Rascunhos

```bash
# Criar rascunho de texto
npm run linkedin:draft:create -- --content="Texto do post"

# Criar rascunho com link preview (article)
npm run linkedin:draft:create -- --content="Texto" --article-source="https://..." --article-title="Titulo" --article-description="Descricao"

# Criar rascunho com imagem
npm run linkedin:draft:create -- --content="Texto" --image-path="/caminho/absoluto/imagem.png" --image-alt="Descricao da imagem"

# Listar rascunhos
npm run linkedin:draft:list

# Ver rascunho especifico
npm run linkedin:draft:show -- --draft-id=<uuid>

# Atualizar rascunho
npm run linkedin:draft:update -- --draft-id=<uuid> --content="Texto atualizado"

# Remover rascunho
npm run linkedin:draft:delete -- --draft-id=<uuid>
```

### Publicacao

```bash
# Preparar (congela o conteudo, retorna confirmation-id)
npm run linkedin:publish:prepare -- --draft-id=<uuid>

# Confirmar (publica de fato)
npm run linkedin:publish:confirm -- --confirmation-id=<uuid>
```

### Historico

```bash
npm run linkedin:history:list
```

### Analytics

```bash
npm run linkedin:analytics
npm run linkedin:analytics -- --days=30
```

### Posts publicados

```bash
npm run linkedin:posts:sync
```

Sincroniza todos os posts publicados do Zernio para `.local/linkedin/zernio-posts.json`.
Usado pelos agentes de memoria editorial, duplicatas e performance para analisar conteudo historico.

### Mencoes

Para mencionar alguem num post, primeiro resolva o perfil:

```bash
npm run linkedin:mention:resolve -- --url="https://linkedin.com/in/nome-do-perfil"
```

O comando retorna o URN e o display name. Depois, insira a mencao diretamente no texto do post usando o formato:

```
@[Nome Completo](urn:li:person:xxxxx)
```

## Dados locais

Os dados ficam em `.local/linkedin/`:

| Arquivo | Conteudo |
|:--------|:---------|
| `drafts.json` | Rascunhos ativos |
| `drafts.backup.json` | Backup atomico dos rascunhos |
| `publish-history.jsonl` | Historico append-only de publicacoes |
| `zernio-posts.json` | Cache dos posts publicados sincronizado do Zernio |

## Agentes Copilot

O projeto inclui agentes especializados em `.github/agents/` para o fluxo completo de criacao de posts:

| Agente | Responsabilidade |
|:-------|:----------------|
| LinkedIn Publishing Orchestrator | Roteador principal. Detecta fase e delega |
| LinkedIn Topic Interviewer | Clarificacao de tema, objetivo e angulo |
| LinkedIn Editorial Memory | Contexto historico: temas cobertos, gaps, cadencia |
| LinkedIn Post Critic | Revisao editorial: hook, CTA, tamanho, valor |
| LinkedIn Hook Optimizer | Avalia e otimiza hooks com alternativas por tipo |
| LinkedIn Voice Validator | Valida voz do autor: emojis, tom, filler corporativo |
| LinkedIn Fact Checker | Verifica claims factuais e precisao tecnica |
| LinkedIn Performance Coach | Recomenda formato, tamanho e timing baseado em dados |
| LinkedIn Format Strategist | Decide formato: text-only, article-preview ou image |
| LinkedIn Visual Briefing | Briefing visual e prompt para geracao de imagem |
| LinkedIn Duplicate Guard | Verificacao de duplicatas com similarity scoring |
| LinkedIn Preview QA | Valida rendering: OG metadata, limites, integridade |
| LinkedIn Draft Manager | Operacoes CLI: draft, prepare, confirm, history |

Agentes externos (nao neste repo): `reepl-linkedin` (copy generation).

Diretrizes editoriais em `.github/instructions/linkedin-editorial-guidelines.instructions.md`.

## Testes

```bash
npm test
```

Roda todos os testes com o test runner nativo do Node.js (`node --test`).

## Limitacoes

- Projeto single-user e local-only.
- Publicacao, analytics e resolucao de mencoes passam exclusivamente pelo Zernio CLI.
- Nao ha forma suportada de publicacao direta sem `prepare` + `confirm`.
- Rascunhos usam JSON simples com escrita atomica. Se `drafts.json` corromper, os comandos falham com erro claro.
