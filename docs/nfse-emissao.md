# Módulo de emissão de NFS-e (Sefin Nacional) no gestor-escritorio

Origem: o app local `C:\projetos\emissor-nfse` (Python), que já emitiu notas em produção restrita e em
produção (Simple Care, NFS-e nº 13). Este módulo leva o mesmo núcleo para a nuvem, dentro do gestor.

Decisões (15/10/2026):
- **Nuvem, dentro do gestor-escritorio**: Netlify (telas + functions) + Supabase (banco).
- **Multiempresas**: cada cliente do gestor (`clientes`) pode ter configuração de emissão e certificado A1.
- **WhatsApp**: mensagens encaminhadas chegam pelo `whatsapp-webhook.js` e entram numa fila **para aprovação**.
- **Recorrentes**: cadastro com dia do mês; no dia, o cron gera as notas e elas entram na fila **para aprovação**.

## Fases

0. **Login e proteção.** Hoje o gestor não tem login nem RLS: a chave anônima do Supabase está no navegador
   e qualquer pessoa com a URL lê e grava qualquer tabela. Para o módulo de NFS-e:
   - Supabase Auth no gestor (tela de login);
   - tabelas `nfse_*` com RLS (só usuário autenticado; certificados nunca acessíveis pelo navegador);
   - functions de NFS-e conferem o token do usuário antes de qualquer ação.
1. **Núcleo em JavaScript** (`netlify/functions/lib/nfse/`): DPS a partir do gabarito, assinatura XMLDSIG,
   cliente mTLS da Sefin, máquina de estados. Testes golden: o Python gera DPS assinadas de referência e o JS
   precisa produzir **os mesmos bytes** (RSA PKCS#1 v1.5 é determinística, então até a assinatura bate).
2. **Banco**: `nfse_empresas` (configuração + gabarito importado de um XML de NFS-e já emitida),
   `nfse_certificados` (pfx e senha cifrados com AES-256-GCM, chave só no Netlify), `nfse_lotes`, `nfse_notas`,
   `nfse_sequencias` (por empresa + ambiente + série), `nfse_eventos`.
   **Migrar a Simple Care**: série 900 em produção já usou o nº 1 (NFS-e 13). A sequência na nuvem tem que
   continuar do 2, senão a Sefin rejeita a DPS por Id repetido.
3. **Tela "Emitir NFS-e"**: empresa, importação (colar/planilha), prévia editável, competência, emissão nota a nota,
   relatório. Validar em produção restrita depois do deploy.
4. **WhatsApp**: o webhook reconhece pedidos de nota (grupo/número → empresa), usa o mesmo parser e manda
   para a fila "A aprovar".
5. **Recorrentes**: cadastro (tomador, serviço, valor, dia do mês, competência) + `nfse-cron` diário.

## Painel do cliente: notas emitidas e DANFSe (19/10/2026)

- **Seção "Notas fiscais emitidas — MM/AAAA"** no painel do cliente (`PainelCompartilhadoPage`), com
  número, tomador, valor e botões **PDF** e **XML**. Só aparece quando há nota autorizada de **produção**
  na competência (pela `dCompet` da DPS). O escritório pode ocultá-la no modo de edição, como as outras.
- **Function `painel-nfse`**: lista e entrega PDF/XML. O cliente entra pelo token do painel
  (`x-painel-token`, ver `docs/seguranca-rls.md`) e só vê as notas dele de produção; o escritório
  logado vê qualquer cliente e, na tela de emissão, também as de homologação.
- **DANFSe gerado pelo gestor** (`netlify/functions/lib/nfse/danfse/`). A API pública de DANFSe do
  Ambiente Nacional foi **suspensa em 03/08/2026** (NT SE/CGNFS-e nº 008/2026 v1.02), e a geração
  passou para o software emissor. O PDF segue o Anexo I da NT: A4 em uma página, grade e posições do
  item 2.4.5, logomarca da NFS-e, QR Code da consulta pública, "NFS-e SEM VALIDADE JURÍDICA" em
  homologação, blocos não identificados suprimidos e traço em campo vazio. Gerado na hora a partir
  do `xml_retorno` (menos de 1 s); não fica guardado.
  - Fonte: Helvetica no lugar de Arial/Microsoft Sans Serif (não dá para embutir as fontes da
    Microsoft); as métricas da Helvetica são as da Arial.
  - Marca d'água "CANCELADA"/"SUBSTITUÍDA" já existe no gerador (`marcaDagua`), mas o módulo ainda
    não registra cancelamento/substituição de nota.
  - Municípios fora do XML (endereço do tomador) vêm da API de localidades do IBGE; se ela falhar,
    sai o código.
- Tela "Emitir NFS-e": link **PDF (DANFSe)** ao lado de "XML NFS-e" nas notas autorizadas.
- Testes: `danfse.test.cjs` e `painelNfse.test.cjs` (`npm run test:nfse`, 42 no total).

## Leiaute NT 009/2026 (20/10/2026)

A NT SE/CGNFS-e nº 009 v1.01 (Anexo VI v1.04.01) mudou a DPS. Na produção restrita passou a valer
depois de 15/10/2026 (em 20/10 a Sefin rejeitou com E1235: faltava `finNFSe`); na produção, a partir
de **03/11/2026**. `dps.js` (`aplicarLeiauteNt009`) insere, só a partir dessas datas:

- `finNFSe = 0` (NFS-e regular) logo depois de `tpEmit`;
- `indDest = 0` (destinatário = tomador) logo depois de `toma`;
- para optante do Simples ME/EPP ou pendente (`opSimpNac` 3 ou 4): `regApIBSCBSSN` (depois de
  `regApTribSN`) e `cAtvSN` (antes de `xDescServ`), obrigatórios pelo Anexo VI (RN 313 e 449). Os dois
  vêm da configuração da empresa (tela "Emitir NFS-e" → Editar), não do gabarito.
  Simple Care: regApIBSCBSSN = 1 (IBS e CBS pelo SN), cAtvSN = 7 (exclusivamente Anexo III);
- grupo `IBSCBS` (E0855: obrigatório para competência a partir de 01/10/2026): `cIndOp` e
  `valores/trib/CST` + `cClassTrib`, mais o NBS do serviço (`cNBS`), também da configuração da empresa.
  Simple Care: NBS 1.2301.23.00 e cIndOp 030101 (Anexo VIII, odontologia), CST 200 / cClassTrib 200029
  (saúde humana, Anexo III da LC 214/2025, redução de 60% — a Calculadora recusa 200028, que é educação).

A Sefin liga a NT em fases, então cada grupo tem a sua data por ambiente (`NT009_DATAS` em `dps.js`):

| Grupo | Homologação | Produção |
|---|---|---|
| finNFSe | 16/10/2026 | 03/11/2026 |
| IBSCBS (com indDest dentro dele até a fase do indDest) | 20/10/2026 | 03/11/2026 |
| indDest na raiz de infDPS | 30/10/2026 | 03/11/2026 |
| regApIBSCBSSN e cAtvSN (Simples) | 03/11/2026 | 03/11/2026 |

Cada data muda sem mexer no código pela variável `NFSE_NT009_<GRUPO>_<AMBIENTE>=AAAA-MM-DD` no Netlify
(ex.: `NFSE_NT009_SIMPLES_HOMOLOGACAO`); `NFSE_NT009_PRODUCAO_A_PARTIR` muda a produção de todos.
**Validado em 20/10/2026:** NFS-e nº 4 da Simple Care autorizada na produção restrita com finNFSe e IBSCBS
(DPS série 900 nº 11). Antes de 03/11, emitir de novo em homologação depois de 30/10 para conferir a fase
do indDest; se a Sefin recusar regApIBSCBSSN/cAtvSN em produção, adiar o grupo SIMPLES pela variável. O XSD oficial do leiaute novo ainda não tinha sido publicado em 20/10/2026 (o pacote da
produção restrita é de 27/07/2026); a ordem dos campos segue a aba "LEIAUTE DPS_NFS-e - RT" do Anexo VI.
O DANFSe lê `finNFSe`/`indDest`/`dest` da posição nova e da antiga.

## Cadastro de clientes do prestador (tomadores) — 23/10/2026

- Tabela `nfse_tomadores` (`supabase-schema-nfse-tomadores.sql`, aplicado): nome, CPF, apelidos, endereço,
  contato, descrição e valor padrão, por empresa. Mesma regra de RLS (logado só lê; escrita pela function).
- Tela "Emitir NFS-e" → **Clientes do prestador**: busca, cadastro/edição, e **importação de planilha de
  controle** (nome | CPF | meses...): descobre as colunas sozinha, lê apelido entre parênteses
  ("Maria Helena Costa (José Ricardo)"), completa CPF sem o zero à esquerda, avisa DV errado e CPF repetido
  (repetido fica de fora para conferência). Sempre com prévia antes de gravar.
- Ao importar atendimentos, o que faltar vem do cadastro: CPF **só quando o nome bate sem dúvida** (todas as
  palavras do nome menor, no mínimo duas, uma pessoa só) ou por apelido; nome parecido vira aviso com o
  candidato. Pelo nome, fica o nome da mensagem (mais completo); pelo apelido, a nota sai no nome do cadastro.
- **Lista datada** (agenda: linha com a data, depois "Nome valor" por linha) é reconhecida no texto colado.
- `nfse_empresas.descricao_padrao`: descrição do serviço quando nem a mensagem nem o cadastro trazem.
- Testes: `tomadores.test.cjs` (dados fictícios no formato da planilha real).

## Link "todas as notas emitidas" do cliente (27/10/2026)

- **Link:** `?notas=<token do painel>`. Na tela "Emitir NFS-e", o botão **Link: todas as notas** copia o link
  (`NotasEmitidasPage.jsx`). É separado do painel mensal: lista **todas** as NFS-e emitidas pela empresa,
  inclusive as que não saíram do gestor (Emissor Nacional, notas antigas). Tem busca (paciente, número,
  descrição), filtro por ano e mês, total, e por nota **PDF** (DANFSe com QR Code da consulta pública),
  **XML** e **WhatsApp** (link assinado do PDF, 30 dias). Canceladas e substituídas ficam escondidas, com
  opção de mostrar; o PDF delas sai com marca d'água.
- **De onde vêm:** distribuição do Ambiente de Dados Nacional, `GET adn.nfse.gov.br/contribuintes/DFe/{NSU}`
  com o A1 da empresa (`lib/nfse/adn.js`). Até 50 documentos por chamada, em ordem de NSU. Guardamos só as
  notas em que a empresa é **emitente** (`nfse_adn_notas`) e o último NSU lido (`nfse_adn_controle`);
  eventos de cancelamento (101101, 105104, 305101) e substituição (105102) marcam a nota.
  Conferido em 27/10/2026 com a Simple Care: 135 documentos desde 02/2023 (28 emitidas, 107 recebidas),
  leitura completa em menos de 1 s, DANFSe gerado para as 28.
- **Quando atualiza:** ao abrir o link, se a última leitura tiver mais de 15 min (function `nfse-emitidas`).
  Falha do ADN não derruba a página: mostra as notas já salvas, com aviso.
- **Banco:** `supabase-schema-nfse-adn.sql` (rodar no SQL Editor; mesma regra de RLS das outras `nfse_*`).
- Testes: `nfseEmitidas.test.cjs`.

## Regras herdadas do app local (não mudar)

- nDPS reservado e gravado **antes** de qualquer chamada HTTP; número nunca reutilizado.
- Timeout/erro de rede/5xx → `indeterminada`. Reenvio só depois de `GET /dps/{id}` responder `E2404`.
- XML assinado é guardado e reaproveitado em qualquer reenvio (mesmo Id, mesmo dhEmi).
- C14N: gerar a forma canônica diretamente; não confiar em canonizadores de terceiros sem o teste golden
  (o libxml2 e o signxml inserem `xmlns=""` em DPS com namespaces padrão aninhados → E0714 na Sefin).
- Homologação e produção com numeração separada.

## Andamento (15/10/2026)

- [x] Login (src/components/ComLogin.jsx), usuário criado no Supabase, cadastro público desligado.
- [x] Tabelas nfse_* com RLS (supabase-schema-nfse.sql) aplicadas no Supabase.
- [x] Núcleo JS em netlify/functions/lib/nfse/ com paridade byte a byte com o Python; function nfse.js.
      Testes: `npm run test:nfse` (32).
- [x] Tela "Emitir NFS-e" (src/pages/nfse/) e item no menu.
- [x] Migração da Simple Care: sequência série 900 = 9 (produção) e 4 (homologação); NFS-e 13 a 21 com XMLs
      num lote "migracao" (gerado por emissor-nfse/scripts/gerar_migracao_gestor.py, fora do git).
- [ ] Netlify: NFSE_CERT_KEY e NFSE_EMAILS_PERMITIDOS; publicar; configurar a Simple Care na tela
      (gabarito + certificado) e testar 1 nota em homologação antes de produção.
- [x] Painel do cliente com as notas emitidas e DANFSe em PDF (ver seção acima).
- [ ] Antes de publicar: emitir 1 nota em homologação, conferir o PDF pela tela de emissão e o painel
      (com uma nota de produção já migrada, ex.: NFS-e 21).
- [ ] Fases 4 (WhatsApp) e 5 (recorrentes).

## Trava de duplicidade e nota cancelada

Conferida na hora de emitir (não só na importação), contra as notas já emitidas ou em emissão do mesmo CPF:

- **Igual** — mesmo CPF, mesma data de atendimento e mesmo valor: bloqueada, nada é enviado.
- **Parecida** — mesmo CPF e mesmo valor, com data ou competência no mesmo mês: a tela pergunta
  nota por nota "Emitir mesmo assim?" (Cancelar pula a nota). Na revalidação do lote ela já aparece
  com o aviso "Possível nota repetida".

Nota cancelada no portal nacional: na linha da nota, **Cancelada no portal** registra o motivo. Ela sai do
painel do cliente, dos totais e da trava (a nota certa pode ser emitida de novo). Requer
`supabase-schema-nfse-cancelamento.sql` aplicado no Supabase.
