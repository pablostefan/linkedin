# LinkedIn Official API Demo

Projeto minimo para conectar uma conta do LinkedIn via OAuth oficial, obter informacoes basicas do perfil, manter rascunhos locais e publicar posts de texto no perfil autenticado com confirmacao obrigatoria em duas etapas.

## O que este projeto faz

- Login com LinkedIn via OAuth 2.0 + OpenID Connect
- Persistencia local minima de auth em `.local/linkedin/auth.json`
- Leitura de perfil basico com `GET /me`
- CRUD local de rascunhos com UUID estavel
- Preparacao e confirmacao obrigatoria antes de publicar
- Historico local append-only em `.local/linkedin/publish-history.jsonl`
- Tentativa opcional de listar posts do autor com `GET /posts`
- Sincronizacao manual best effort de posts do proprio perfil via navegador em `.local/linkedin/sync/`

## Requisitos

- Node.js 18+
- Uma app criada em LinkedIn Developers
- Chromium instalado pelo pacote `playwright` durante `npm install` ou via `npx playwright install chromium`

## Configuracao da app no LinkedIn

1. Acesse o portal de developers do LinkedIn e crie uma app.
2. Em Auth, configure o redirect URL:
   - `http://localhost:3901/auth/linkedin/callback`
3. Ative o produto de login:
   - `Sign In with LinkedIn using OpenID Connect`
4. Ative o produto de postagem que conceda `w_member_social`.
   - Dependendo da disponibilidade na sua app, isso pode aparecer como `Share on LinkedIn` ou `Community Management API`.
5. Copie `Client ID` e `Client Secret`.

### Para conseguir ler posts ja publicados

Para puxar posts existentes do seu perfil pessoal, nao basta `w_member_social`.
Voce precisa que o LinkedIn aprove o escopo restrito `r_member_social` para a sua app.

Na pratica, confira isto no portal:

1. A app precisa estar associada ao produto `Community Management API` ou a outro produto que de acesso ao escopo `r_member_social`.
2. O escopo `r_member_social` precisa estar efetivamente liberado para o app, nao apenas documentado.
3. Depois da aprovacao, atualize `LINKEDIN_SCOPES` no `.env` para incluir `r_member_social`.
4. Refaça o login com `npm run linkedin:auth`, porque o token atual nao recebe escopos novos automaticamente.

Se o LinkedIn nao liberar `r_member_social`, a API oficial nao vai conseguir listar seus posts antigos do perfil pessoal.

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Campos principais:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `SESSION_SECRET`
- `LINKEDIN_API_VERSION`
- `LINKEDIN_SYNC_START_URL` opcional para sobrescrever a pagina inicial do sync manual via navegador

Observacoes:

- O contrato local do MVP eh fixo em `http://localhost:3901`.
- O servidor Express faz bind somente em `127.0.0.1`.
- `LINKEDIN_REDIRECT_URI` deve continuar apontando para `http://localhost:3901/auth/linkedin/callback`.

Escopos padrao:

- `openid`
- `profile`
- `email`
- `w_member_social`

Escopo adicional para leitura de posts existentes, somente apos aprovacao:

- `r_member_social`

## Instalar e rodar

```bash
npm install
npm run dev
```

Abra:

- `http://localhost:3901`

## Fluxo canonico no VS Code com Copilot

1. Inicie o servidor local com `npm run dev`.
2. Peça ao Copilot para executar `npm run linkedin:auth`.
3. Abra a URL retornada em JSON no navegador e conclua o login do LinkedIn.
4. A callback persistira apenas `accessToken`, `expiresAt`, `scope`, `personUrn` e um resumo minimo do usuario em `.local/linkedin/auth.json`.
5. Verifique o estado atual com `npm run linkedin:status`.
6. Se seu app tiver `r_member_social` aprovado, atualize o `.env`, reautentique e use `npm run linkedin:posts:list` para testar a leitura de posts existentes.
7. Crie um rascunho com `npm run linkedin:draft:create -- --content="Texto do post"`.
8. Liste ou inspecione rascunhos com `npm run linkedin:draft:list` e `npm run linkedin:draft:show -- --draft-id=<uuid>`.
9. Prepare a publicacao com `npm run linkedin:publish:prepare -- --draft-id=<uuid>`.
10. Revise o JSON retornado, incluindo `confirmationId`, `content` e `expiresAt`.
11. Confirme a publicacao com `npm run linkedin:publish:confirm -- --confirmation-id=<uuid>`.
12. Consulte o historico local com `npm run linkedin:history:list`.

Todos os comandos imprimem JSON por padrao para facilitar o uso pelo Copilot no VS Code.

## Sincronizacao manual via navegador

O MVP de sync nao usa scheduler, watch nem loop recorrente. O comando roda uma vez, captura o que estiver visivel na pagina e persiste estado minimo para a proxima execucao incremental.

Arquivos usados por esse fluxo:

- `.local/linkedin/browser-profile/` para o perfil persistente do Chromium
- `.local/linkedin/sync/posts.json` para os posts sincronizados
- `.local/linkedin/sync/state.json` para o estado incremental minimo

Comandos:

```bash
npm run linkedin:sync:status
npm run linkedin:sync:run
npm run linkedin:sync:list
npm run linkedin:sync:backfill
npm run linkedin:sync:backfill:deep
```

Opcoes uteis:

```bash
npm run linkedin:sync:run -- --start-url="https://www.linkedin.com/in/me/recent-activity/all/"
npm run linkedin:sync:run -- --max-scrolls=8
npm run linkedin:sync:run -- --headless=false
npm run linkedin:sync:run -- --full-scan=true --enrich-all=true --max-scrolls=60
```

Fluxo esperado na primeira execucao:

1. Rode `npm run linkedin:sync:run`.
2. Se o LinkedIn abrir tela de login ou a sessao do perfil persistente estiver invalida, o Chromium permanece aberto por alguns minutos para voce concluir o login manualmente.
3. Depois que o login for concluido no Chromium, o proprio comando tenta continuar a sincronizacao.
4. Se o tempo expirar sem login, o comando falha com `browser_login_required`.
5. Depois disso, as proximas execucoes reutilizam `.local/linkedin/browser-profile` no modo single-run local.

Opcao util para aumentar a janela de login manual:

```bash
npm run linkedin:sync:run -- --login-timeout-ms=600000
```

Para varrer a pagina inteira e tentar trazer todos os posts visiveis do seu historico atual, use o backfill completo:

```bash
npm run linkedin:sync:backfill
```

Esse modo:

- nao para no primeiro post ja conhecido
- continua rolando ate o fim da pagina ou ate o limite configurado
- prioriza velocidade e nao faz enriquecimento pesado por permalink

Se voce quiser a versao mais lenta e profunda, com enriquecimento completo por permalink, use:

```bash
npm run linkedin:sync:backfill:deep -- --login-timeout-ms=600000
```

Consultar posts ja sincronizados sem abrir o JSON bruto:

```bash
npm run linkedin:sync:list
npm run linkedin:sync:list -- --limit=5
npm run linkedin:sync:list -- --query="XP"
npm run linkedin:sync:list -- --query="XP" -- --include-raw-metrics=true
```

Dados capturados no MVP, em best effort:

- texto do post
- data/hora visivel e timestamp normalizado, incluindo valores relativos como `5 d` e `2 sem` quando possivel
- URL do post quando encontrada
- tipo simples do post: `text`, `image`, `video`, `document` ou `article`
- metricas visiveis quando parseaveis
- indicadores simples de midia

Limitacoes do sync MVP:

- O scraper depende da estrutura atual do DOM do LinkedIn e pode degradar se a interface mudar.
- A captura e best effort e prioriza uma unica fonte: o navegador autenticado.
- Nao ha garantia de recuperar todo o historico em uma execucao; a abordagem e incremental e para uso manual.
- O comando nao escreve em `.local/linkedin/publish-history.jsonl` e nao se mistura com o fluxo atual de publicacao.

## Re-auth e invalidez de token

- Se o auth local expirar, o status mudara para `reauth_required`.
- Se o LinkedIn responder `401` em `/posts`, `publish confirm` ou outra operacao autenticada, o arquivo `.local/linkedin/auth.json` sera apagado automaticamente.
- Para reautenticar, execute novamente `npm run linkedin:auth` e repita o login no navegador.

## Endpoints

### `GET /me`

Retorna o resumo minimo persistido do usuario autenticado e `personUrn`, mesmo depois de reiniciar o servidor local.

### `GET /posts`

Tenta listar posts do autor autenticado.

Importante:

- Esse endpoint exige o escopo restrito `r_member_social` aprovado no LinkedIn.
- Sem esse escopo, a API costuma responder `403 ACCESS_DENIED`.
- Isso nao impede login nem a preparacao e confirmacao de publicacoes.

### `npm run linkedin:posts:list`

Atalho via CLI para testar `GET /posts` depois que o app estiver aprovado com `r_member_social`.

Exemplos:

```bash
npm run linkedin:posts:list
npm run linkedin:posts:list -- --count=20
```

### `POST /posts`

Nao publica mais diretamente. O endpoint agora rejeita bypass do fluxo de confirmacao.

### `GET /operator/status`

Retorna `authenticated` ou `reauth_required` com a URL de login local.

### `GET /operator/drafts`

Lista os rascunhos locais de `.local/linkedin/drafts.json`.

### `POST /operator/drafts`

Cria um rascunho local.

Body:

```json
{
   "content": "Meu primeiro post via API oficial do LinkedIn."
}
```

### `PATCH /operator/drafts/:draftId`

Atualiza um rascunho existente sem trocar o UUID.

### `DELETE /operator/drafts/:draftId`

Remove um rascunho local.

### `POST /operator/publish/prepare`

Congela o conteudo exato que sera publicado e retorna um `confirmationId` de uso unico.

Body:

```json
{
   "draftId": "uuid-do-rascunho"
}
```

ou

```json
{
   "content": "Texto avulso preparado para publicacao."
}
```

Resposta:

```json
{
   "confirmationId": "uuid",
   "draftId": "uuid-ou-null",
   "content": "Texto congelado para publicar.",
   "expiresAt": "2026-04-06T00:10:00.000Z"
}
```

### `POST /operator/publish/confirm`

Executa a publicacao real apenas quando recebe a confirmacao minima.

Body:

```json
{
   "confirmationId": "uuid",
   "confirm": true
}
```

### `GET /operator/history`

Lista o historico local mais recente de publicacoes e falhas.

## Limitacoes importantes

- O projeto continua single-user e local-only.
- O projeto usa sessao em memoria apenas para o estado OAuth do navegador. O auth reutilizavel fica em `.local/linkedin/auth.json`.
- O servidor local nao aceita bind fora de `localhost`/`127.0.0.1`.
- O fluxo de publicacao exige sempre `prepare` seguido de `confirm`. Nao ha caminho suportado de publicacao direta.
- Os rascunhos usam JSON simples com escrita atomica de arquivo inteiro. Se `drafts.json` estiver corrompido, a API falha fechada com erro claro.
- O LinkedIn pode exigir aprovacao adicional para alguns escopos de leitura e analytics.
- Analytics de perfil e posts nao estao incluidos aqui porque normalmente exigem acesso adicional da Community Management API.

## Proximos passos naturais

- Persistir tokens em banco
- Renovar tokens com fluxo de expiracao adequado
- Adicionar suporte a posts com imagem, artigo e documento
- Adicionar publicacao em pagina da empresa com `w_organization_social`