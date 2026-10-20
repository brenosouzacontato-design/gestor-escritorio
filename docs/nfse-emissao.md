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
  Simple Care: regApIBSCBSSN = 1 (IBS e CBS pelo SN), cAtvSN = 7 (exclusivamente Anexo III).

Se a Sefin adiar a produção, a variável `NFSE_NT009_PRODUCAO_A_PARTIR=AAAA-MM-DD` no Netlify muda a
data. O XSD oficial do leiaute novo ainda não tinha sido publicado em 20/10/2026 (o pacote da
produção restrita é de 27/07/2026); a ordem dos campos segue a aba "LEIAUTE DPS_NFS-e - RT" do Anexo VI.
O DANFSe lê `finNFSe`/`indDest`/`dest` da posição nova e da antiga.

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
