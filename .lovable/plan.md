## Escopo

Manter o sistema atual intacto e adicionar três frentes:

1. **Admin global** — já está pronto (URL/Token globais, instâncias automáticas `wt{slug}-N`). Apenas validar UX e bloquear qualquer vazamento dessas credenciais para o usuário comum (nenhuma mudança estrutural).
2. **Criação de Grupos** a partir da lista de contatos triados como "Aprovado".
3. **Campanhas de Disparo (Transmissão Virtual)** com motor anti-bloqueio (delay randômico 30–60s entre mensagens, pausa obrigatória de 5 minutos a cada 5 envios).

## Banco de dados (nova migration)

Tabelas em `public` (com GRANTs + RLS por `user_id`, admins via `has_role`):

- **`campaigns`** — `id`, `user_id`, `name`, `message` (text), `media_url` (text, nullable), `status` (`draft` | `running` | `paused` | `completed` | `failed`), `total`, `sent_count`, `failed_count`, `current_streak` (int — contador do lote de 5), `next_run_at` (timestamptz — quando o motor pode disparar de novo), `last_status_text` (texto exibido no painel: "Aguardando…", "Pausa térmica até HH:MM:SS"), `started_at`, `finished_at`.
- **`campaign_recipients`** — `id`, `campaign_id`, `contact_id`, `whatsapp_id`, `name`, `phone_number`, `status` (`pending` | `sent` | `failed`), `error`, `sent_at`. Índice em `(campaign_id, status)`.
- **`whatsapp_groups`** (registro local do que foi criado) — `id`, `user_id`, `evo_group_id`, `name`, `description`, `members_count`.

## Server functions novas (`src/lib/campaigns.functions.ts`, `src/lib/groups.functions.ts`)

Grupos:
- `createGroup({ name, description, contactIds[] })` → chama `/group/create` na Evolution com participantes (JIDs), grava em `whatsapp_groups`.

Campanhas:
- `createCampaign({ name, message, contactIds[] })` → cria registro + recipients, status `draft`.
- `listCampaigns()`, `getCampaign(id)` (com recipients + estatísticas para o painel).
- `startCampaign(id)` / `pauseCampaign(id)` / `resumeCampaign(id)` / `cancelCampaign(id)`.
- `tickCampaigns()` (server route público, ver abaixo) — motor do disparo.

## Motor anti-bloqueio (cron a cada minuto)

Arquivo: `src/routes/api/public/hooks/campaign-tick.ts` (POST, `apikey` header validado).

Lógica por chamada:
1. Buscar campanhas com `status='running'` e `next_run_at <= now()`.
2. Para cada uma:
   - Pegar o próximo `recipient` pendente.
   - Enviar via Evolution `/message/sendText/{instance}` usando credenciais globais + instância do `user_id` da campanha.
   - Marcar como `sent` (ou `failed`) e incrementar contadores.
   - **Cadência**:
     - `current_streak + 1`
     - Se `current_streak === 5`: `next_run_at = now() + 300s`, zerar streak, `last_status_text = "Pausa térmica até HH:MM"`.
     - Senão: delay aleatório entre 30 e 60s → `next_run_at = now() + rand`, `last_status_text = "Aguardando próximo envio em Xs"`.
   - Se não há mais pendentes: `status='completed'`, `finished_at=now()`.

Agendamento: `pg_cron` rodando `*/1 * * * *` chamando o endpoint público com `apikey` anon. O endpoint processa todas as campanhas em uma única invocação (cada uma envia no máximo 1 mensagem por tick, respeitando o `next_run_at`).

## UI

- **`/contacts`** (aprovados): seleção múltipla com checkboxes, dois botões na barra: **"Criar grupo"** (modal nome+descrição) e **"Nova campanha"** (modal nome+mensagem).
- **`/campaigns`** (nova rota `_authenticated/campaigns.tsx`): lista de campanhas com status, progresso (X/Y), botões Iniciar/Pausar/Retomar.
- **`/campaigns/$id`** (nova rota): painel de monitoramento em tempo real (polling 3s) com barra de progresso, status dinâmico textual (lendo `last_status_text` e calculando countdown a partir de `next_run_at`), tabela de recipients com status.
- Item "Campanhas" na sidebar do layout `_authenticated`.

## Pontos técnicos importantes

- Reuso do helper `evoFetch` e `getEvoConfig` existentes.
- Apenas o admin vê/edita URL+Token (já implementado em `/settings`).
- O tick é idempotente: respeita `next_run_at`, então rodar várias vezes não acelera o disparo.
- O endpoint público valida `apikey` para evitar abuso externo.
- RLS bloqueia o usuário de ver campanhas/grupos de outros; admins veem tudo.

## Entregáveis nesta rodada

1. Migration (campaigns, campaign_recipients, whatsapp_groups + RLS + GRANTs).
2. `groups.functions.ts` + `campaigns.functions.ts` + endpoint público de tick.
3. Cron `pg_cron` (insert via tool após a migration).
4. Rotas e UIs novas + integração na tela de contatos aprovados.

Posso prosseguir?
