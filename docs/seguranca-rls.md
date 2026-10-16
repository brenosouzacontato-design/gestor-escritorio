# Segurança do banco: login do escritório + RLS

> Status: **proposta**. Nada daqui foi aplicado no Supabase de produção. Cada passo
> que mexe no banco precisa de aprovação explícita do dono do escritório.

## 1. O problema hoje

- O front fala com o Supabase usando a **chave anônima** (`src/lib/supabase.js`,
  `VITE_SUPABASE_ANON_KEY`). Essa chave vai dentro do JavaScript publicado no Netlify:
  qualquer pessoa que abre o site consegue copiá-la.
- **Nenhuma tabela tem RLS ligado.** Os scripts `supabase-schema*.sql` fazem
  `disable row level security` de propósito (o app não tem login).
- Resultado: com a URL do site, qualquer um consegue, pela API REST do Supabase,
  **ler, alterar e apagar** clientes, tarefas, honorários, lançamentos contábeis,
  documentos, o painel do cliente e a tabela `configuracoes`, que guarda os **tokens do
  OneFlow** (`of_user_token`, `of_refresh_token`, `of_escritorio_token`).
- O bucket `documentos` do Storage tem policies sem filtro de papel
  (`supabase-schema-documentos.sql`): qualquer um com a chave anônima lê, sobe e apaga
  arquivos (guias, comprovantes, declarações, relatórios da Receita).
- As Netlify Functions não pedem autenticação (ver seção 7).

O que **continua funcionando** depois da mudança: tudo que roda com
`SUPABASE_SERVICE_KEY` (as Netlify Functions e crons). A service key ignora RLS.

## 2. Modelo de acesso proposto

Três tipos de quem acessa:

| Quem | Como se identifica | O que vê |
|---|---|---|
| **Escritório** (dono e colaboradores) | Login do Supabase Auth (e-mail + senha) **e** cadastro na tabela `escritorio_usuarios` | Tudo |
| **Cliente** (painel e links compartilhados) | Token do painel, um por cliente, enviado no cabeçalho `x-painel-token` | Só as linhas do próprio cliente, quase sempre só leitura |
| **Servidor** (Netlify Functions, crons, webhook) | `SUPABASE_SERVICE_KEY` | Tudo (ignora RLS) |

Pontos de projeto:

- **Ter conta no Auth não basta.** A função `is_escritorio()` confere se o usuário está
  em `escritorio_usuarios` e ativo. Se alguém conseguir criar conta (cadastro público
  ligado por engano), não vê nada.
- **Login e NFS-e já existem (sessão do módulo NFS-e).** A tela de login
  (`src/components/ComLogin.jsx`, Supabase Auth com e-mail e senha, só o dono, sem
  cadastro público) envolve o `<App />` em `src/main.jsx`, e os links públicos ficam
  fora dela. Esta proposta conta com o role `authenticated` vindo desse login e **não
  mexe** em `ComLogin.jsx`, `main.jsx`, `App.jsx` nem nas tabelas `nfse_*`
  (`supabase-schema-nfse.sql`, que já têm RLS próprio). **Atenção ao ligar o passo 2:**
  o dono precisa estar em `escritorio_usuarios`, senão entra pelo login mas vê zero
  linhas. Sugestão para o módulo de NFS-e, quando houver mais de um usuário: trocar
  "authenticated lê" por `is_escritorio()` nas policies `nfse_*`.
- **Token do painel em vez do id do cliente.** Hoje o link é `?painel=<clientes.id>`, e
  o id não é segredo (a tabela `clientes` inteira é pública). Proposta: coluna
  `clientes.painel_token` (32 caracteres aleatórios), link `?painel=<token>`, e função
  `girar_painel_token(cliente_id)` para trocar o token se um link vazar.
- **Como o token chega ao banco.** As páginas públicas criam um cliente Supabase
  separado com `global.headers = { 'x-painel-token': token }`. O PostgREST expõe os
  cabeçalhos em `request.headers`, e a função `painel_cliente_id()` devolve o cliente
  dono do token. As policies do painel comparam `cliente_id = painel_cliente_id()`.
  Vantagem: as consultas de leitura do painel (`painelApi.js`) continuam iguais, só
  trocam de cliente Supabase.
- **O que o cliente grava vira RPC.** Onde uma policy liberaria mais do que o
  necessário (upsert, ou update de uma coluna só), a gravação passa por uma função
  `security definer` que confere o token: `painel_registrar_push`,
  `painel_salvar_observacao`.
- **Arquivos do Storage para o cliente saem de uma Netlify Function.** Os arquivos do
  bucket têm nome aleatório (`<uuid>.pdf`), sem pasta por cliente, então uma policy de
  Storage teria de procurar o arquivo em 4 tabelas. Mais simples e seguro: a function
  `painel-arquivo` (nova) recebe `{ token, storagePath }`, confere com a service key que
  o arquivo pertence ao cliente do token (em `documentos`, `dados_gerenciais_simples`,
  `situacao_fiscal_rfb` ou `cnd_manual`) e devolve a URL assinada.

## 3. Inventário por tabela

Legenda: **E** = escritório (front, hoje com chave anônima), **P** = páginas públicas
(painel e links compartilhados, hoje com chave anônima), **F** = Netlify Function
(service key). "Política proposta" vale depois do passo 2.

Todas as tabelas abaixo ganham a policy `escritorio_total` (tudo para
`is_escritorio()`); a coluna "Política proposta" lista só o que existe **além** disso.

### Cadastro e rotina do escritório

| Tabela | Quem lê hoje | Quem grava hoje | Política proposta |
|---|---|---|---|
| `clientes` | E (store, Obrigações, honorários, contábil), P (todas as páginas públicas), F (webhook, painel-evento, oneflowFiscal) | E | Só escritório. Cliente lê os próprios dados pela RPC `painel_sessao()` (colunas que o painel usa; sem honorário/observações internas). |
| `tarefas` | E (Tarefas, Clientes, Empresas, Obrigações, andamento, documentos), P (painel), F (candidatosDocumento) | E, F (whatsapp-webhook cria tarefa) | + anônimo com token lê as do próprio cliente. |
| `tarefa_comentarios` | E (Tarefas) | E | Só escritório. |
| `obrigacoes` | E (várias telas), P (painel) | E | + anônimo com token lê as do próprio cliente. |
| `etapas_obrigacao` | E (andamento, documentos), P (`?doc=`, via join), F (candidatosDocumento) | E | + anônimo com token lê as etapas das obrigações do próprio cliente. |
| `etapas_template` | E (andamento) | E | Só escritório. |
| `historico_obrigacao` | E (andamento) | E | Só escritório. |
| `departamentos` | E (andamento), P (join no painel) | E | + anônimo com token válido lê (tabela de referência, sem dado de cliente). |
| `tipos_obrigacao` | E (andamento), P (join no painel) | E | + anônimo com token válido lê (referência). |
| `cliente_entrega_competencia` | E (Empresas) | E | Só escritório. |
| `cliente_tipos_obrigacao_excluidos` | E (andamento) | E | Só escritório. |
| `lembretes` | E (lembretes), F (lembretes-cron) | E, F (cron marca enviado) | Só escritório. |
| `fechamentos_erp` | E (store) | E | Só escritório. |
| `prospectos` | E (store) | E | Só escritório. |
| `parcelamentos` | E (Parcelamentos) | E | Só escritório. |
| `parcelamento_parcelas` | E (Parcelamentos) | E | Só escritório. |
| `configuracoes` | E (store, OneFlow, honorários), P (chave PIX no painel), F (sincronizar notas, lembrete de honorários) | E | + anônimo com token lê **só** `honorarios_pix_chave` e `honorarios_pix_favorecido`. Os tokens do OneFlow deixam de ser públicos. |

### Contábil

| Tabela | Quem lê hoje | Quem grava hoje | Política proposta |
|---|---|---|---|
| `contas_contabeis` | E (contábil), P (balancete compartilhado) | E | + anônimo com token lê as da própria empresa. |
| `lancamentos_contabeis` | E (contábil, store), P (painel, identificar lançamentos) | E, P (cliente grava `observacao_cliente`) | + anônimo com token lê os da própria empresa. Gravação do cliente pela RPC `painel_salvar_observacao` (só essa coluna, só da própria empresa). |
| `partidas_contabeis` | E (contábil) | E | + anônimo com token lê as partidas dos lançamentos da própria empresa. |
| `vw_movimento_contas` (view) | E, P (DRE/balancete compartilhado) | — | `security_invoker = true`: passa a obedecer o RLS de `lancamentos_contabeis`/`partidas_contabeis`. **Sem isso a view devolve o movimento de todas as empresas mesmo com RLS ligado.** |
| `regras_classificacao` | E (contábil) | E | Só escritório. |
| `lancamentos_identificacao_links` | E, P (identificar lançamentos) | E | + anônimo com token lê os da própria empresa. |

### Documentos, fiscal e honorários

| Tabela | Quem lê hoje | Quem grava hoje | Política proposta |
|---|---|---|---|
| `documentos` | E (documentos, Empresas), P (painel, `?doc=`), F (extrair-valor-guia, comprovantePagamento, webhook) | E (inclusive modo de edição do painel), F (webhook insere, extrair-valor-guia atualiza) | + anônimo com token lê os do próprio cliente. Link `?doc=<id>` usa a RPC `documento_publico(id)`. |
| `documentos_whatsapp` | E (documentos) | F (webhook) | Só escritório. |
| `documentos_fiscais_erp` | E (contábil), P (painel, notas fiscais compartilhadas), F (oneflowFiscal grava) | F | + anônimo com token lê as do próprio cliente. |
| `dados_gerenciais_simples` | E, P (painel, comprovante de faturamento) | E (upload da declaração, modo de edição) | + anônimo com token lê os do próprio cliente. |
| `situacao_fiscal_rfb` | E, P (painel) | E | + anônimo com token lê os do próprio cliente. |
| `cnd_manual` | E, P (painel) | E | + anônimo com token lê os do próprio cliente. |
| `honorarios` | E (honorários), P (painel), F (cron e lembrete) | E, F (marca lembrete enviado) | + anônimo com token lê os do próprio cliente. |

### Painel do cliente

| Tabela | Quem lê hoje | Quem grava hoje | Política proposta |
|---|---|---|---|
| `painel_visualizacoes` | E (última visita) | P (cada abertura do link) | + anônimo com token **só insere**, e só para o próprio cliente. |
| `painel_eventos` | E (modo admin do painel) | F (painel-evento) | Só escritório (a function grava com service key). |
| `painel_recados` | P (painel) | E (modo de edição) | + anônimo com token lê os do próprio cliente. |
| `painel_push_assinaturas` | E (conta aparelhos), F (painel-push) | P (upsert ao ativar notificações), F (apaga expiradas) | Só escritório. Cliente grava pela RPC `painel_registrar_push`. |

### Storage

| Bucket | Hoje | Proposta |
|---|---|---|
| `documentos` (privado) | Policies `documentos_insert/select/delete` sem filtro: qualquer um com a chave anônima lê, sobe e apaga | Policy `documentos_escritorio` (só `is_escritorio()`). Cliente baixa pela function `painel-arquivo`. Webhook e functions seguem com service key. |

### Tabelas novas desta proposta

| Tabela | Política |
|---|---|
| `escritorio_usuarios` | RLS ligado. Escritório lê; só o `dono` inclui, altera ou desativa. |

## 4. Páginas públicas e o que muda nelas

Todas são montadas em `src/main.jsx` por parâmetro de URL.

| Link | Página | Lê | Grava | Mudança |
|---|---|---|---|---|
| `?painel=` | `PainelCompartilhadoPage`, `PainelClientePage` (`&versao=1`) | quase todas as tabelas do painel | `painel_visualizacoes`, `painel_push_assinaturas`, `lancamentos_contabeis.observacao_cliente`, function `extrair-valor-guia` | Parâmetro passa a ser o token. Cliente Supabase com cabeçalho. `clientes` → `painel_sessao()`. Push → RPC. Downloads → `painel-arquivo`. |
| `?share=dre` / `balancete` | `RelatorioCompartilhadoPage` | `clientes`, `contas_contabeis`, `vw_movimento_contas` | — | `&empresa=` passa a ser o token. |
| `?share=notasfiscais` | `NotasFiscaisCompartilhadoPage` | `clientes`, `documentos_fiscais_erp` | — | Idem. |
| `?share=faturamento` | `ComprovanteFaturamentoPage` | `clientes`, `dados_gerenciais_simples` | — | Idem. |
| `?identificar=1` | `IdentificarLancamentosPage` | `clientes`, `lancamentos_contabeis`, `lancamentos_identificacao_links` | `observacao_cliente` | Idem + RPC `painel_salvar_observacao`. |
| `?doc=` | `DocumentoCompartilhadoPage` | `documentos` + joins, URL assinada | — | RPC `documento_publico(id)` + `painel-arquivo`. O id (uuid aleatório) continua sendo o segredo do link, mas deixa de ser listável. |

O modo admin do painel (`admin` em `PaineisPage`/`PainelViewerModal`) roda dentro do app
logado e usa o cliente Supabase normal, então as gravações do modo de edição
(`definirSecoesOcultasPainel`, `atualizarDadosGerenciais`, `atualizarValorGuia`,
`marcarGuiaPaga`, `salvarRecadoPainel`) seguem pela policy do escritório.

**Links já enviados.** Com o token novo, os links `?painel=<id>` antigos param de
funcionar e precisam ser reenviados. Alternativa, se reenviar a todos for trabalhoso:
no passo 1, preencher `painel_token = id::text` para os clientes atuais (os links
antigos continuam valendo) e girar o token cliente a cliente depois. **Recomendo
gerar tokens novos**: os ids estiveram públicos pela API, então quem os copiou poderia
continuar abrindo os painéis.

## 5. Mudanças no código (implementadas)

Feitas sem mexer em `ComLogin.jsx`, `main.jsx`, `App.jsx` nem `nfse_*`. Tudo funciona
**com e sem** o banco preparado: enquanto `supabase-rls-01-preparacao.sql` não rodar,
o front cai no caminho antigo (RPC ausente, link com id) e as functions só registram
aviso no log.

1. **Login do escritório:** já existe em `src/components/ComLogin.jsx` (sessão do
   módulo NFS-e). Falta só cadastrar o dono em `escritorio_usuarios` (passo 1).
2. **Cliente Supabase do painel** (`src/lib/supabase.js`): `ativarModoPainel(token)`
   troca o cliente exportado por um que manda `x-painel-token` em toda consulta. O
   `export let supabase` é uma ligação viva, então as consultas de `painelApi.js` e
   `contabilApi.js` não mudaram. `cabecalhosFunctions()` monta os cabeçalhos das
   chamadas às functions: token do painel no link público, JWT do escritório no app.
3. **Páginas públicas** (`src/pages/painel/AcessoPainel.jsx`): cada página pública é
   envolvida por `AcessoPainel`, que liga o modo painel, chama `painel_sessao()` e só
   então monta a página com o id real do cliente. Os dados do cliente vêm da sessão (o
   anônimo não lê `clientes`). Token inválido mostra "Link inválido ou expirado".
   No modo admin (dentro do app) nada muda. Links antigos (com id) continuam abrindo
   enquanto o RLS estiver desligado.
4. **Gravações do cliente:** visita é insert direto (a policy permite);
   push → `painel_registrar_push`; resposta de lançamento → `painel_salvar_observacao`;
   `?doc=` → `documento_publico`. Sem a RPC no banco, cada uma usa o caminho antigo.
5. **Downloads:** no link público, `criarLinkAssinado`/`abrirLinkAssinado` pedem a URL
   à function nova `painel-arquivo`, que confere se o arquivo é do cliente do token
   (documentos e comprovantes, declaração do Simples, relatório da Receita, anexos de
   CND). O escritório continua assinando direto no Storage.
6. **Links** (`src/lib/linksPublicos.js`): painel, DRE/balancete, notas fiscais,
   comprovante de faturamento e identificação de lançamentos saem com
   `clientes.painel_token` (ou com o id, enquanto a coluna não existir). Em **Painéis**,
   o botão **"Gerar novo link"** chama `girar_painel_token` (com confirmação).

## 6. Ordem de implantação

Cada passo é reversível e não deixa o app fora do ar.

| Passo | O que | Efeito no app | Precisa de aprovação |
|---|---|---|---|
| 0 | Rodar [`supabase-rls-00-diagnostico.sql`](../supabase-rls-00-diagnostico.sql) | Nenhum (só leitura). Confirma estado real das tabelas criadas fora do repo (`obrigacoes`, `parcelamentos`, `parcelamento_parcelas`, `prospectos`, `tarefa_comentarios`) e o tipo da coluna `clientes.carteira`. | Sim (acesso ao banco) |
| 1 | Deploy deste código (com o login de `ComLogin.jsx` junto) | Nada visível: functions aceitam chamadas sem login com aviso no log; links seguem com id. | Sim (deploy) |
| 2 | Rodar [`supabase-rls-01-preparacao.sql`](../supabase-rls-01-preparacao.sql); criar usuários no Auth; desligar cadastro público; vincular o dono em `escritorio_usuarios` | Links novos passam a sair com token; os antigos ainda abrem. "Gerar novo link" passa a funcionar. | **Sim** |
| 3 | Reenviar os links do painel aos clientes | — | — |
| 4 | Rodar [`supabase-rls-02-ativar.sql`](../supabase-rls-02-ativar.sql) e, no Netlify, `EXIGIR_AUTENTICACAO=1` | Chave anônima sozinha vê zero linhas; links antigos param; functions exigem login ou token. | **Sim** |
| 5 | Webhook do WhatsApp: `WHATSAPP_WEBHOOK_SEGREDO` no Netlify e `setx WHATSAPP_WEBHOOK_SEGREDO ...` na máquina do `iniciar-gestor.bat`, depois rodar o .bat | O webhook passa a recusar chamadas sem o segredo. Ligar as duas pontas juntas, senão os documentos do WhatsApp param de chegar. | Sim |
| 6 | Testes da seção 8 | — | — |
| ↩ | Se quebrar: [`supabase-rls-99-reverter.sql`](../supabase-rls-99-reverter.sql) e tirar `EXIGIR_AUTENTICACAO` | Volta ao comportamento de antes (policies ficam guardadas). | — |

Recomendação: fazer os passos 1 a 4 primeiro num **projeto Supabase de teste**
(branch do Supabase ou cópia do banco) apontado por um deploy de preview do Netlify.

### Variáveis de ambiente novas (Netlify)

| Variável | Efeito |
|---|---|
| `EXIGIR_AUTENTICACAO` | `1` = functions recusam quem não tem login do escritório nem token do painel, e o id dos links antigos deixa de valer. Sem ela, só avisam no log. |
| `WHATSAPP_WEBHOOK_SEGREDO` | Se definida, `whatsapp-webhook` só aceita `?segredo=<valor>` na URL. |

## 7. Netlify Functions (implementado)

RLS não protege as functions, porque elas usam a service key. A guarda está em
`netlify/functions/lib/autenticacao.js`: confere o JWT do escritório
(`supabase.auth.getUser` + `escritorio_usuarios`; antes do passo 2 basta o login), o
token do painel, ou o segredo interno (function chamando function, derivado da
service key).

| Function | Quem chama | Risco antes | O que foi feito |
|---|---|---|---|
| `painel-evento` | painel (cliente) | Eventos falsos para o WhatsApp do escritório, com qualquer `clienteId` | Cliente sai do token do painel; o `clienteId` do corpo só vale fora do modo estrito. |
| `painel-push` (POST) | modo admin do painel | **Qualquer um mandava notificação para o celular de qualquer cliente** | Exige login do escritório. GET (chave VAPID pública) continua aberto. |
| `extrair-valor-guia` | painel e escritório | Gasto de crédito da Anthropic e alteração de `documentos` | Escritório, ou token do painel do **dono** do documento. |
| `extrair-declaracao-simples`, `extrair-situacao-fiscal`, `extrair-extrato`, `identificar-documento` | escritório | Gasto de crédito da Anthropic por terceiros | Exige login do escritório. |
| `honorarios-enviar-lembrete`, `honorarios-prever-lembrete` | escritório | **Qualquer um disparava cobrança por WhatsApp** | Exige login do escritório. |
| `documentos-fiscais-sincronizar` / `-background` | escritório / a própria app | Disparo da sincronização com o OneFlow | Exige login; a background exige o segredo interno (mandado por `dispararSincronizacaoBackground`). |
| `oneflow-proxy` | escritório | Aberto a qualquer um; a lista de hosts usava `startsWith`, então `https://app.omie.com.br.qualquercoisa.com` passava | Exige login e compara o hostname exato. |
| `painel-arquivo` (nova) | painel e `?doc=` | — | URL assinada só de arquivo do cliente do token (ou do documento do `?doc=`). |
| `whatsapp-webhook` | Evolution API | Qualquer um injetava documentos falsos | `?segredo=` quando `WHATSAPP_WEBHOOK_SEGREDO` está definida; `iniciar-gestor.bat` monta a URL com ele. |
| `lembretes-cron`, `honorarios-cron`, `documentos-fiscais-cron` | agendador do Netlify | Pela documentação do Netlify, funções agendadas não são chamáveis por URL em produção (confirmar com um curl) | Nada. |

Há também `supabase/functions/oneflow-proxy` (Edge Function), que o front não usa (ele
chama a versão do Netlify). Se estiver publicada no Supabase, remover ou proteger.

## 8. Como testar depois do passo 4

Com a chave anônima (a mesma do bundle), sem login:

```bash
curl -s "$SUPABASE_URL/rest/v1/clientes?select=id,nome" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Esperado: `[]`. Repetir para `configuracoes`, `honorarios`, `vw_movimento_contas`.

Com o token de um cliente:

```bash
curl -s "$SUPABASE_URL/rest/v1/obrigacoes?select=titulo,cliente_id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "x-painel-token: TOKEN_DO_CLIENTE"
```

Esperado: só as obrigações daquele cliente. Em `configuracoes`, só as duas chaves PIX.

No app: login, carregar todas as abas, abrir o painel de um cliente pelo link novo,
baixar uma guia, ativar notificações, responder um lançamento, abrir um `?doc=`.

### Já validado

Os scripts foram rodados num Postgres 16 descartável (Docker) com stubs mínimos de
`auth`, `storage` e das tabelas. Resultado:

- 00, 01 (duas vezes seguidas) e 02 rodam sem erro.
- Anônimo sem token: zero linhas em `clientes`, `obrigacoes`, `configuracoes` e na view.
- Anônimo com token do cliente A: vê só as obrigações, etapas, partidas e movimento de
  A; em `configuracoes` só a chave PIX (o `of_user_token` não aparece); não consegue
  gravar observação em lançamento de B, nem registrar visita para B, nem girar token.
- Usuário autenticado **fora** de `escritorio_usuarios`: zero linhas.
- Usuário do escritório: vê e altera tudo, gira token, acessa o Storage.

Depois, com o código das seções 5 e 7, num PostgREST v12 de verdade (Docker) na
frente desse banco:

- O cabeçalho `x-painel-token` chega às policies por `request.headers`: com `tokA`
  só aparecem dados de A; sem token, ou com token errado, `[]`.
- `documento_publico` devolve `null` nos vínculos vazios, no formato do join do
  supabase-js.
- `painel-arquivo`, `painel-evento`, `extrair-valor-guia` e as guardas do escritório,
  rodando com supabase-js e um Auth/Storage simulados, nos dois modos de
  `EXIGIR_AUTENTICACAO`: A não baixa arquivo de B nem mexe em guia de B; login fora de
  `escritorio_usuarios` é recusado; link antigo (id) só vale fora do modo estrito.
- No navegador (Vite apontando para esse banco): link com token inválido mostra "Link
  inválido ou expirado"; `?painel=tokA` resolve o cliente e as consultas saem com o
  cabeçalho (a chave PIX só volta com ele).
- `vite build` passa; todas as functions passam em `node --check`.

**Não** foi testado contra o Supabase real (Auth e Storage de verdade, schema completo).
O passo 0 e um ensaio num projeto de teste continuam necessários.

## 9. Pontos de atenção

- **Tabela nova = RLS ligado e sem policy.** Toda tabela criada daqui em diante precisa
  da policy `escritorio_total` (e, se o painel usar, `painel_ler`). Os scripts novos
  devem parar de fazer `disable row level security`.
- **Colunas internas em tabelas que o painel lê.** RLS filtra linhas, não colunas. Com o
  token, o cliente pode pedir pela API colunas que a tela não mostra (ex.: `observacao`
  de tarefas, campos internos de `documentos` ou `honorarios`). Se alguma coluna não
  puder ser vista pelo cliente, trocar a leitura por uma view ou RPC só com as colunas
  certas, como foi feito em `clientes`.
- **Tarefas internas.** Hoje o painel lê todas as tarefas do cliente. Se houver tarefa
  que o cliente não deve ver, criar uma coluna (ex.: `visivel_cliente`) e incluí-la na
  policy.
- **`created_by`** em `lancamentos_contabeis` já referencia `auth.users`; com login dá
  para começar a preenchê-lo.
- **Chave anônima continua pública**, e isso é normal no Supabase: com RLS ligado ela só
  dá acesso ao que as policies liberam. Não é preciso trocá-la. A `SUPABASE_SERVICE_KEY`
  nunca pode ir para o front (`VITE_*`).
- **Tokens do OneFlow** ficaram legíveis publicamente até agora. Depois do passo 4,
  vale gerar tokens novos no OneFlow.
