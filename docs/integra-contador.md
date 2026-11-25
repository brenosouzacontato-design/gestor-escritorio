# Integra Contador (SERPRO)

API oficial da Receita/SERPRO, usada no gestor (menu **Documentos → Integra Contador**) para:

| Aba | Serviço SERPRO | O que faz |
|-----|----------------|-----------|
| Recalcular DARF | `SICALC / CONSOLIDARGERARDARF51` (Emitir, v2.9) | multa e juros até a data do pagamento + PDF do DARF |
| DAS do Simples | `PGDASD / GERARDAS12` (Emitir, v1.0) | DAS de uma declaração já transmitida; com data de pagamento = DAS recalculado |
| Parcelamentos SN/MEI | `<sistema> / PARCELASPARAGERARxx2` (Consultar) e `GERARDASxx1` (Emitir) | lista as parcelas disponíveis e emite o DAS da parcela |

Parcelamentos aceitos: PARCSN, PARCSN-ESP, PERTSN, RELPSN, PARCMEI, PARCMEI-ESP, PERTMEI, RELPMEI.
Parcelamentos da **PGFN não estão** no Integra Contador; continuam pelo robô do SISPAR.

Códigos conferidos no catálogo da documentação em 25/11/2026 e testados no ambiente de
demonstração do SERPRO (as respostas reais estão em `netlify/functions/lib/serpro/__tests__/fixtures`).

## Como funciona

```
Tela (src/pages/integra/IntegraContadorPage.jsx)
  → netlify/functions/integra-contador.js   (login do escritório)
      → lib/serpro/integraContador.js        autenticação + chamada
      → lib/serpro/servicos.js               monta os dados e lê as respostas
  → PDF no bucket "documentos" (integra/<id>.pdf) + linha em integra_guias
  → "Enviar para Documentos do cliente": cria o documento (status confirmado, valor e
     vencimento preenchidos) e a guia segue o fluxo normal de Documentos/Entregas
```

Autenticação: `POST https://autenticacao.sapi.serpro.gov.br/authenticate` com TLS mútuo usando o
**certificado e-CNPJ do escritório (contratante)** + `Basic base64(ConsumerKey:ConsumerSecret)` e
`Role-Type: TERCEIROS`. O token (≈30 min) é reaproveitado e renovado sozinho no 401.

O escritório é contratante e autor dos pedidos, então **não precisa do Termo de Autorização**
(Autentica Procurador). Mas **cada empresa precisa ter dado procuração eletrônica no e-CAC ao CNPJ
do escritório** para os serviços usados (ver "Serviços × Procurações" na documentação do SERPRO).

Cada requisição é cobrada pelo SERPRO e fica registrada em `integra_chamadas`. A tela mostra quantas
requisições foram feitas no mês.

## Colocar no ar

1. Rodar `supabase-schema-integra-contador.sql` no Supabase.
2. No Netlify (Site configuration → Environment variables):
   - `SERPRO_CONSUMER_KEY` e `SERPRO_CONSUMER_SECRET`, da Área do Cliente SERPRO → Chaves de Acesso;
   - `NFSE_CERT_KEY` já existe (é o cofre dos certificados da NFS-e e também cifra o do escritório).
   - opcional: `SERPRO_AMBIENTE=trial` para testar com a demonstração pública (dados simulados,
     sem gastar requisições). Tire a variável para usar o contrato de verdade.
3. Deploy.
4. Na tela Integra Contador → Configuração, envie o **.pfx do e-CNPJ do escritório** e a senha.
5. Teste com uma empresa que tenha procuração: um DAS de um mês já declarado é o mais simples.

## Erros comuns

- **"Autenticação no SERPRO recusada"**: chaves erradas/trocadas ou certificado diferente do
  usado na contratação.
- **Mensagem do SERPRO sobre procuração/autorização**: a empresa não deu procuração ao escritório
  no e-CAC para aquele serviço.
- **DARF recusado por data**: a data do pagamento precisa ser dia útil.
- **Município**: o Sicalc usa o código TOM da Receita (não o IBGE); deixe em branco para usar o
  cadastro do contribuinte.

## Testes

`npm run test:integra` — funções puras e o cliente (token, renovação no 401), com respostas reais
da demonstração.
