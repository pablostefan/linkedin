# Menções (@mention) em Posts do LinkedIn

Guia completo para criar menções clicáveis de pessoas e empresas nos posts publicados via este projeto.

## Conceito

Menções clicáveis no LinkedIn exigem um formato especial no texto do post. O LinkedIn não aceita apenas digitar `@Nome`: é preciso incluir o URN (identificador único) da pessoa ou empresa no formato correto. Caso contrário, o texto aparece como texto puro, sem link.

## Workflow em 2 Passos

### Passo 1: Resolver o perfil (URL para URN)

Use o comando de resolução passando a URL do perfil LinkedIn:

```bash
# Pessoa
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/in/nome-do-perfil/"

# Empresa
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/company/nome-da-empresa/"
```

O comando retorna 3 campos:

| Campo | Descrição | Exemplo |
|:------|:----------|:--------|
| `displayName` | Nome exato do perfil no LinkedIn | `Renato Dantas` |
| `urn` | Identificador único da entidade | `urn:li:person:sysgA09BAZ` |
| `mentionFormat` | Formato pronto para colar no post | `@[Renato Dantas](urn:li:person:sysgA09BAZ)` |

Exemplo de saída:

```json
{
  "urn": "urn:li:person:sysgA09BAZ",
  "type": "person",
  "displayName": "Renato Dantas",
  "mentionFormat": "@[Renato Dantas](urn:li:person:sysgA09BAZ)"
}
```

### Passo 2: Incluir o mentionFormat no texto do post

Copie o valor de `mentionFormat` e insira diretamente no conteúdo do post:

```bash
npm run linkedin:draft:create -- --content="Obrigado @[Renato Dantas](urn:li:person:sysgA09BAZ) pela ajuda!"
```

A API do Zernio interpreta esse formato e converte em uma menção clicável no LinkedIn.

## Formato da Menção

```
@[Nome Exato](urn:li:person:ID)       # Pessoa
@[Nome da Empresa](urn:li:organization:ID)  # Empresa
```

Exemplos reais:

```
@[Renato Dantas](urn:li:person:sysgA09BAZ)
@[XP Inc.](urn:li:organization:11794476)
```

## Regras Críticas

### 1. O displayName DEVE ser o nome exato do perfil

O LinkedIn valida o nome. Se estiver diferente do perfil, a menção vira texto puro silenciosamente, sem nenhum erro.

| displayName usado | Perfil real | Resultado |
|:------------------|:------------|:----------|
| `Mateus Pereira, CFP®` | Mateus Pereira, CFP® | Menção clicável |
| `Mateus Pereira` | Mateus Pereira, CFP® | Texto puro (sem link) |
| `mateus pereira` | Mateus Pereira, CFP® | Texto puro (sem link) |

### 2. SEMPRE usar o mentionFormat retornado pela API

Nunca montar o formato manualmente. Sempre executar `mention:resolve` e usar o `mentionFormat` retornado, pois ele já contém o `displayName` exato e o URN correto.

### 3. Menções inválidas falham silenciosamente

Se o nome, URN ou formato estiver incorreto, o LinkedIn não retorna erro. O texto simplesmente aparece como texto puro no post, sem link clicável.

### 4. urn:li:member NÃO funciona

O formato `urn:li:member:<numericId>` retorna HTTP 400. Sempre usar:

- Pessoas: `urn:li:person:<opaqueString>`
- Empresas: `urn:li:organization:<numericId>`

### 5. O campo mentions da API Zernio é apenas referência

O campo `mentions` no body do `POST /v1/posts` é informativo. Ele NÃO cria menções no LinkedIn. As menções só funcionam quando o `mentionFormat` está dentro do campo `content`.

## Exemplo Completo

```bash
# 1. Verificar status
npm run linkedin:status

# 2. Resolver a menção
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/in/renato-dantas-415640169/"
# Retorna: mentionFormat = @[Renato Dantas](urn:li:person:sysgA09BAZ)

# 3. Criar rascunho com a menção no texto
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/in/renato-dantas-415640169/"
npm run linkedin:draft:create -- --content="Obrigado @[Renato Dantas](urn:li:person:sysgA09BAZ) pela ajuda na integração do Pix!"

# 4. Revisar o rascunho
npm run linkedin:draft:show -- --draft-id=<uuid>

# 5. Preparar e confirmar publicação
npm run linkedin:publish:prepare -- --draft-id=<uuid>
npm run linkedin:publish:confirm -- --confirmation-id=<uuid>
```

## Múltiplas Menções no Mesmo Post

Resolva cada perfil separadamente e inclua todos os `mentionFormat` no texto:

```bash
# Resolver cada pessoa
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/in/pessoa-a/"
npm run linkedin:mention:resolve -- --url="https://www.linkedin.com/in/pessoa-b/"

# Criar rascunho com ambas
npm run linkedin:draft:create -- --content="Obrigado @[Pessoa A](urn:li:person:AAA) e @[Pessoa B](urn:li:person:BBB) pelo projeto!"
```

## Como Funciona Internamente

1. O comando `npm run linkedin:mention:resolve` chama `src/zernio.js` que faz um `GET` para:
   ```
   https://zernio.com/api/v1/accounts/{accountId}/linkedin-mentions?url=<URL>
   ```
2. O Zernio usa a API do LinkedIn para resolver a URL do perfil em um URN.
3. Na publicação, o campo `content` contendo `@[Nome](urn:...)` é interpretado pelo Zernio e enviado à UGC Shares API do LinkedIn como menção formatada.

## Troubleshooting

| Problema | Causa provável | Solução |
|:---------|:---------------|:--------|
| Menção aparece como texto puro | `displayName` não é exato | Usar o `mentionFormat` retornado pela API |
| HTTP 400 ao publicar | URN usa `urn:li:member` | Usar `urn:li:person` (resolver via `mention:resolve`) |
| Comando `mention:resolve` falha | Zernio não configurado | Verificar com `npx zernio status` |
| Menção de empresa não funciona | URL incorreta | Usar URL de company page: `linkedin.com/company/slug/` |
