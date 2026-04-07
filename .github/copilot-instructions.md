# Instruções do Projeto LinkedIn

Este repositório é um assistente local de publicação no LinkedIn usado pelo GitHub Copilot no VS Code.

## Objetivo Principal

- Ajudar o usuário a criar e publicar posts de texto no seu perfil pessoal do LinkedIn através do workflow local do projeto.
- Preferir o workflow CLI do projeto em vez de chamadas HTTP avulsas.

## Workflow Canônico Para Novos Posts

1. Verificar conectividade Zernio com `npm run linkedin:status`. Se falhar, instruir o usuário a verificar a configuração com `npx zernio status`.
2. Criar ou atualizar conteúdo como rascunho local com `npm run linkedin:draft:create` ou `npm run linkedin:draft:update`.
5. Se o post deve ter link preview, criar como article post passando `--article-source`, `--article-title` e `--article-description`.
6. Se o post deve ter uma imagem, passar `--image-path` e opcionalmente `--image-alt`.
7. Revisar o rascunho com `npm run linkedin:draft:show` ou `npm run linkedin:draft:list`.
8. Preparar publicação com `npm run linkedin:publish:prepare`.
9. Sempre mostrar o conteúdo preparado exato ao usuário e pedir confirmação explícita antes de publicar.
10. Publicar somente após confirmação explícita do usuário com `npm run linkedin:publish:confirm`.
11. Verificar o resultado com `npm run linkedin:history:list`.

## Regras de Segurança

- Nunca publicar diretamente via `POST /posts`; publicação direta está intencionalmente desabilitada.
- Nunca pular o passo de `prepare`.
- Nunca executar `publish:confirm` sem aprovação explícita do usuário para aquele conteúdo exato.
- Tratar `npm run linkedin:history:list` como fonte da verdade para posts criados por esta ferramenta.
- Para conteúdo e analytics de posts publicados, usar `.local/linkedin/zernio-posts.json` (sincronizado via `npm run linkedin:posts:sync`).

## Backend Zernio

- Publicação e analytics são gerenciados pelo Zernio CLI (`npx zernio`).
- Configuração do Zernio está em `~/.zernio/config.json`.
- O projeto não roda um servidor local. Toda interação com a API do LinkedIn passa pelo Zernio.
- Se o Zernio retornar erro de auth ou conectividade, instruir o usuário a verificar a configuração com `npx zernio status`.

## Comandos Preferenciais

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

## Orientações de Colaboração

- Comunicar com o usuário em português por padrão, salvo pedido de outro idioma.
- O Post Editor pode auxiliar na criação e refinamento do texto, mas o usuário SEMPRE tem a decisão final.
- Manter o usuário no controle da decisão final de publicação.

## Arquitetura de Agentes

Este projeto usa um orquestrador + editor + draft manager. Para workflows de posts no LinkedIn, preferir o `LinkedIn Publishing Orchestrator` que delega para:

| Agente | Função |
|:-------|:-------|
| LinkedIn Post Editor | Colaborar na criação e refinamento do texto do post. |
| LinkedIn Draft Manager | Operações CLI (draft, prepare, confirm) |