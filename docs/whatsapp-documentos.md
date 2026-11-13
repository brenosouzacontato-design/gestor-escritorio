# Grupo "Documentos" do WhatsApp: processamento e NFS-e

Todo arquivo enviado no grupo **Documentos** continua indo para o Drive e para a fila de
Documentos do gestor. Agora o robô responde com um **menu numerado** do que fazer com ele,
conforme o tipo que a IA leu. Quem estiver no grupo responde com o número.

## Menu por tipo de documento

| Documento | Opções (além de *painel*, *tarefa* e *arquivar*) | O que acontece |
|---|---|---|
| Declaração do Simples (PGDAS-D) | **Carregar no painel do cliente** | Faturamento, RBT12, alíquota, anexo e DAS vão para o painel (mesmo resultado do upload em Fechamento). Os meses anteriores sem dados são preenchidos com o histórico da declaração. |
| CND federal, estadual ou municipal | **Anexar a CND ao painel do cliente** | Marca a esfera como regular/pendente, guarda a validade e o PDF fica para o cliente baixar. |
| Relatório de Situação Fiscal | **Carregar no painel do cliente** | Débitos, dívidas ativas e parcelamentos aparecem no painel. |
| Boletos e guias (DAS, DARF, FGTS, GPS, ISS...) | **Anexar e dar baixa: _obrigação/tarefa_** (a sugerida pela IA e outras em aberto da empresa, até 3) | A etapa da obrigação é concluída (a próxima abre; se era a última, a obrigação é concluída) ou a tarefa é marcada como feita. Valor e vencimento da guia são lidos e aparecem no painel. |
| Guia de parcelamento (PARCMEI, PGFN-SISPAR) | **Cadastrar/atualizar o parcelamento** | Mesmo código da tela Parcelamentos: acha a empresa pelo CPF/CNPJ, cria ou atualiza o parcelamento (parcela, valor, vencimento) e liga a guia à obrigação de parcelamento do mês. |
| Qualquer documento | **Anexar ao painel do cliente** · **Criar uma tarefa** · **Só arquivar** | Painel: seção Documentos (guia fica na competência; contrato, alvará etc. ficam fixos). |

Comprovantes de pagamento e extratos bancários seguem como antes (baixa automática / pergunta
"importar o extrato?").

### Como responder

- `1` — escolhe a opção 1 (vale para a mensagem citada ou, sem citar, para o documento mais
  recente esperando resposta, até 24 h).
- `1 Amanda Lima` ou `1 12.345.678/0001-90` — quando a empresa não foi identificada.
- `3 pedir extrato ao cliente` — na opção de tarefa, a descrição.
- `1 avulso` — na guia de parcelamento de quem não é cliente.
- Também vale a palavra: `simples`, `cnd`, `parcelamento`, `baixa`, `painel`, `tarefa`,
  `arquivar` (as quatro primeiras funcionam mesmo se a IA não ofereceu a opção).

O robô avisa "⏳ Processando…" e depois manda o resultado. Se der erro (ex.: empresa não
identificada), o documento continua esperando e dá para responder de novo.

## Emitir NFS-e pelo grupo (tomadores já cadastrados)

Para tomadores cadastrados em **Emitir NFS-e** (Clientes da empresa ou Notas recorrentes):

```
nfse Simple Care Shopee 1.250,00        → nota recorrente: a última semana fechada sem nota
nfse Simple Care Maria Souza 150,00     → tomador cadastrado, atendimento hoje
nfse Simple Care Maria 150 10/11        → com a data do atendimento
nfse Simple Care Mãe do João            → pelo apelido, com o valor padrão do cadastro
nfse Simple Care                        → lista os cadastrados da empresa
nfse                                    → lista as empresas que emitem
```

### MEI (Emissor Nacional)

MEIs com senha do portal e modelo cadastrados em **Documentos → NFS-e MEI** também entram no comando:

```
nfse Monica Silva 8.000,00          → usa o modelo da empresa (tomador, código, município, descrição)
nfse Monica Silva                   → valor sugerido do modelo
nfse Monica Silva Friocargo 7.500   → escolhe o modelo pelo tomador, se a empresa tiver mais de um
nfse Monica Silva 8000 31/10        → com a data de competência
```

A prévia avisa se já existe nota igual no mês (mesmo tomador e valor). Com **sim**, a nota entra na
fila do robô (`nfse_mei_notas`), como o botão Emitir da tela: ele emite no portal e manda o PDF no
WhatsApp do cliente. O andamento fica em Documentos → NFS-e MEI.

Também vale `emitir nota ...` ou `nota: ...`. Sem valor, usa o valor padrão do cadastro. O robô
mostra a **prévia** (empresa, tomador, CPF/CNPJ, valor, data, descrição e se é homologação) e só
emite depois do **sim** (ou cancela com **não**), até 2 h depois. A emissão segue as mesmas regras
da tela: validação, trava de nota repetida e reserva de número. Nota autorizada em produção vai
para o WhatsApp da empresa, como na tela. Se a Sefin rejeitar ou a nota ficar parecida com outra,
ela fica em Emitir NFS-e para conferir.

## Instalação

1. No SQL Editor do Supabase, rode `supabase-schema-documentos-processamento-whatsapp.sql`
   (depois dos scripts de decisão/extrato do WhatsApp e da NFS-e). Sem ele, o grupo continua com a
   pergunta antiga "1 = tarefa / 2 = arquivar" e o comando `nfse` avisa que falta o script.
2. Deploy no Netlify. As funções novas são `documento-processar-background` e
   `nfse-whatsapp-background`; usam as variáveis que já existem (`URL`, `ANTHROPIC_API_KEY`,
   `SUPABASE_*`, `EVOLUTION_*`, `NFSE_CERT_KEY`).

Código: `netlify/functions/lib/processamentoDocumento.js` (menu), `lib/nfseWhatsapp.js`
(comando de NFS-e), `whatsapp-webhook.js` (perguntas e respostas no grupo),
`documento-processar-background.mjs` e `nfse-whatsapp-background.js` (processamento).
