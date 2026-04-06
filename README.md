# LinkedIn Official API Demo

Projeto minimo para conectar uma conta do LinkedIn via OAuth oficial, obter informacoes basicas do perfil e publicar posts no perfil autenticado.

## O que este projeto faz

- Login com LinkedIn via OAuth 2.0 + OpenID Connect
- Leitura de perfil basico com `GET /me`
- Publicacao de post de texto com `POST /posts`
- Tentativa opcional de listar posts do autor com `GET /posts`

## Requisitos

- Node.js 18+
- Uma app criada em LinkedIn Developers

## Configuracao da app no LinkedIn

1. Acesse o portal de developers do LinkedIn e crie uma app.
2. Em Auth, configure o redirect URL:
   - `http://localhost:3000/auth/linkedin/callback`
3. Ative o produto de login:
   - `Sign In with LinkedIn using OpenID Connect`
4. Ative o produto de postagem que conceda `w_member_social`.
   - Dependendo da disponibilidade na sua app, isso pode aparecer como `Share on LinkedIn` ou `Community Management API`.
5. Copie `Client ID` e `Client Secret`.

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Campos principais:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`
- `SESSION_SECRET`
- `LINKEDIN_API_VERSION`

Escopos padrao:

- `openid`
- `profile`
- `email`
- `w_member_social`

## Instalar e rodar

```bash
npm install
npm run dev
```

Abra:

- `http://localhost:3000`

## Fluxo de uso

1. Abra a home local.
2. Clique em `Conectar com LinkedIn`.
3. Autorize a app.
4. A callback salvara o token na sessao local.
5. Use os endpoints abaixo.

## Endpoints

### `GET /me`

Retorna perfil basico e `personUrn` do usuario autenticado.

### `POST /posts`

Publica um post de texto no perfil autenticado.

Body:

```json
{
  "content": "Meu primeiro post via API oficial do LinkedIn.",
  "visibility": "PUBLIC"
}
```

Exemplo com `curl`:

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -b cookie.txt -c cookie.txt \
  -d '{"content":"Meu primeiro post via API oficial do LinkedIn."}'
```

### `GET /posts`

Tenta listar posts do autor autenticado.

Importante:

- Esse endpoint pode falhar com `403` se sua app nao tiver o escopo restrito `r_member_social`.
- Isso nao impede login nem publicacao.

## Limitacoes importantes

- O projeto usa sessao em memoria. Serve para desenvolvimento local, nao para producao.
- O LinkedIn pode exigir aprovacao adicional para alguns escopos de leitura e analytics.
- Analytics de perfil e posts nao estao incluidos aqui porque normalmente exigem acesso adicional da Community Management API.

## Proximos passos naturais

- Persistir tokens em banco
- Renovar tokens com fluxo de expiracao adequado
- Adicionar suporte a posts com imagem, artigo e documento
- Adicionar publicacao em pagina da empresa com `w_organization_social`