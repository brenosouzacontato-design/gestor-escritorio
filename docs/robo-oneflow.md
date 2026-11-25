# Robô do OneFlow — relatório da folha

O gestor pede e o robô do servidor faz na **tela web do OneFlow** o que a API dele não
oferece. A primeira tarefa é **baixar o relatório da folha** de uma empresa numa
competência. A API (`rest.oneflow.com.br`) continua sendo usada para o que ela tem,
como o status da folha e do fiscal na tela Fechamentos ERP.

## Como funciona

```
Fechamentos ERP ("Gerar relatório" / "Relatórios da folha (todas vinculadas)")
   │  netlify/functions/tarefas-robo.js  (exige login do escritório)
   ▼
Supabase: tarefas_robo  (status na_fila)            ← supabase-schema-tarefas-robo.sql
   │
   ▼  a cada minuto
deploy/robo-parcelamentos/oneflow.py  (mesmo container dos outros robôs)
   1. abre o OneFlow com o perfil salvo em /dados/oneflow/perfil
      (sessão caiu → avisa no WhatsApp e espera o login pela tela remota)
   2. segue o roteiro /dados/oneflow/roteiros/relatorio_folha.json
   3. guarda o arquivo em documentos/tarefas-robo/<id>.pdf → tarefa 'ok'
   4. manda no WhatsApp do escritório um resumo (e o PDF, com ONEFLOW_ENVIAR_PDF=1)
   ▼
Fechamentos ERP mostra "Pronto" e o botão "Relatório" (link assinado, 10 min)
```

Status da tarefa: `na_fila` → `processando` → (`aguardando_pessoa`) → `ok` | `erro`.
`cancelada` só vale enquanto está na fila. Uma tarefa travada em `processando` por mais
de 2 h (o robô reiniciou no meio) volta sozinha para a fila, até 3 tentativas.

## Instalar

1. Rode `supabase-schema-tarefas-robo.sql` no Supabase (SQL Editor).
2. Faça o deploy do gestor (a function `tarefas-robo` sobe junto).
3. No servidor, atualize o robô como de costume (`bash robo-parcelamentos/instalar.sh`).
   O instalador copia a pasta `roteiros/` e acrescenta ao `.env`:
   - `ONEFLOW_ATIVO=1` (0 desliga);
   - `ONEFLOW_ENVIAR_PDF=0` (1 = cada relatório também vai no WhatsApp do escritório).

## Calibrar o roteiro (uma vez)

O código não tem os cliques do OneFlow fixos, porque não tínhamos acesso à tela dele.
O caminho fica num **roteiro JSON** que você grava fazendo o caminho uma vez à mão,
pela tela remota (a mesma do captcha dos parcelamentos). Enquanto o roteiro não tiver
`"calibrado": true`, as tarefas ficam na fila com o recado "Aguardando calibração" e
nada é executado.

```
cd /opt/gestor-robo
# 1. grava: abre o OneFlow na tela remota; faça o caminho até baixar o relatório
docker compose exec robo python robo.py oneflow-gravar 11222333000181 10/2026
#    → /dados/oneflow/roteiros/relatorio_folha.gravado.json (rascunho)

# 2. confira o rascunho, apague cliques que sobraram e salve como relatorio_folha.json
nano dados/oneflow/roteiros/relatorio_folha.gravado.json
mv dados/oneflow/roteiros/relatorio_folha.gravado.json dados/oneflow/roteiros/relatorio_folha.json

# 3. testa com OUTRA empresa e competência (prova que o roteiro não ficou preso à gravada)
docker compose exec robo python robo.py oneflow-testar 99888777000166 09/2026
#    → prints e HTML de cada passo + o PDF em /dados/oneflow/teste/<data>/

# 4. deu certo: troque "calibrado": false por true no relatorio_folha.json
```

Na gravação, o CNPJ, a competência e o nome da empresa digitados viram `{cnpj_fmt}`,
`{competencia}`, `{empresa}`... para o roteiro servir a qualquer empresa. Senhas
nunca são gravadas, e o login fica fora do roteiro.

### Passos que o roteiro aceita

| ação        | campos                                          | o que faz |
|-------------|-------------------------------------------------|-----------|
| `ir`        | `url`                                           | abre o endereço |
| `clicar`    | `texto` ou `seletor`, opcional `exato`, `n`     | botão, link, menu, aba ou texto visível (procura em todos os iframes) |
| `preencher` | `campo` (rótulo/placeholder) ou `seletor`, `valor`, opcional `enter` | digita no campo |
| `escolher`  | `campo` ou `seletor`, `valor`                   | `<select>` pelo texto da opção, ou abre o combo e clica na opção |
| `teclar`    | `tecla` (ex.: `Enter`, `Escape`)                | aperta a tecla |
| `esperar`   | `texto`/`seletor` (até 2 min) ou `ms`           | espera aparecer, ou um tempo fixo |
| `baixar`    | `texto` ou `seletor`                            | clica e captura o arquivo (download ou nova aba) |

Opcionais em qualquer passo: `espera_ms` (quanto procurar o elemento, padrão 20 s),
`pausa_ms` (pausa depois do passo) e `nota` (comentário, aparece no log).

Variáveis disponíveis: `{competencia}` (MM/AAAA), `{mes}`, `{ano}`,
`{competencia_iso}` (AAAA-MM), `{competencia_traco}` (MM-AAAA), `{cnpj}` (só números),
`{cnpj_fmt}`, `{empresa}`. Variável escrita errado faz o robô parar com erro, em vez de
digitar o texto literal no OneFlow.

## Quando dá erro

- A mensagem do erro aparece no cartão da empresa em Fechamentos ERP; "Tentar de novo"
  devolve a tarefa à fila.
- O print e o HTML da tela onde parou ficam em `/opt/gestor-robo/dados/oneflow/execucoes/<id>/`.
  Execuções que deram certo não guardam prints.
- Se o OneFlow mudar a tela, grave de novo (`oneflow-gravar`) ou ajuste o passo que falhou.

## Próximos tipos

Para cada tipo novo (relatório de FGTS, 13º, apuração do Simples...), acrescente o tipo
no `check` de `tarefas_robo.tipo` e em `TIPOS` da function, e um roteiro
`/dados/oneflow/roteiros/<tipo>.json`. Tarefas que **alteram** dados no OneFlow (calcular
ou fechar folha, transmitir) devem parar para alguém conferir antes do clique final,
como o `EMISSOR_TRANSMITIR=0` do robô de NF-e.
