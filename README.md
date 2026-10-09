# Planejamento Elev

Painel da Elev para montar planejamentos de conteúdo (posts, carrosséis, reels e stories) e mandar um link para o cliente.

- `index.html`, `app.css`, `app.js`: o site (sem etapa de build).
- `config.js`: URL e chave pública do Supabase. Nunca coloque a chave `service_role` aqui.
- `vercel.json`: faz todos os endereços (`/cc-eventos`, `/p/...`, `/editar/...`) abrirem o painel.

## Endereços
- `/` — painel (pede login)
- `/<cliente>` — link fixo do cliente, sempre o planejamento mais recente
- `/p/<id>` — um planejamento específico

## Supabase
Tabela `plans`, funções `get_plan` e `get_latest_plan`, e o espaço de arquivos `media`.
O cliente só consegue ler pelo link (funções); a lista e a edição exigem login.

## Arquivos (imagens e vídeos)
Com `MEDIA_BASE` preenchido no `config.js`, os arquivos novos vão para o Cloudflare R2 através do Worker em `worker/`
(chaves salvas como `r2:<plano>/<arquivo>`). Sem ele, vão para o Supabase Storage. Os dois convivem.

### Worker (pasta `worker/`)
- Variáveis em `wrangler.toml`; segredos no painel da Cloudflare: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- O bucket precisa de uma regra de CORS liberando `PUT` para os endereços do site.
