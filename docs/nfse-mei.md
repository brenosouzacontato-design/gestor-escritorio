# NFS-e de MEI pelo Emissor Nacional (09/11/2026)

MEI sem certificado A1 não consegue usar a API da Sefin (módulo de `docs/nfse-emissao.md`, que assina a DPS
com o A1). Esses MEIs emitem no **portal** `www.nfse.gov.br/EmissorNacional`, com CNPJ e senha. Aqui o robô
do servidor faz isso por eles, a partir de um modelo, como a CIDA BURGUER faz com as notas recorrentes.

Primeiras empresas (1 a 2 notas por mês), modelos já gravados em 09/11/2026 a partir das notas de 26/10/2026,
todas com código de tributação 17.02.01:

| Empresa | Tomador | Local da prestação | Valor | Descrição |
|---|---|---|---|---|
| MONICA SILVA | FRIOCARGO TRIANGULO LTDA (12.149.289/0001-94) | Uberlândia | 8.000,00 | prestação de serviços em {mes}. |
| GABRIEL HENRIQUE | MMS ARMAZENAGEM E LOGISTICA S/A (49.576.466/0001-29) | Ribeirão das Neves | 7.000,00 | Serviços prestados no mês de {mes}. PIX: … |
| ABIMAEL | MMS ARMAZENAGEM E LOGISTICA S/A | Ribeirão das Neves | 7.000,00 | Serviços prestados em {mes}. |
| ANNE VALLESKA | MMS ARMAZENAGEM E LOGISTICA S/A | Ribeirão das Neves | 7.000,00 | Serviços prestados em {mes}. |

`{mes}` na descrição vira o mês da competência ("novembro de 2026").

## Como funciona

1. **Gestor → Documentos → NFS-e MEI** (`src/pages/nfse/NfseMeiPage.jsx`): lista os clientes com regime MEI.
   Por empresa:
   - **Pegar senhas das observações**: para os MEIs sem senha, lê a linha "… nfse: SENHA" das observações do
     cadastro e grava cifrada (a chave só existe no Netlify).
   - **Senha do Emissor Nacional**: gravada cifrada (AES-256-GCM, `NFSE_CERT_KEY`) em `nfse_mei_acessos`;
     nunca volta para o navegador. Depois de cadastrar, apagar a senha das observações do cadastro.
   - **Modelos**: tomador (opcional; CPF exige nome), código de tributação nacional (6 dígitos, ex. 01.07.01),
     município da prestação (vazio = o que o portal sugerir), descrição, valor sugerido.
   - **Emitir**: confere valor, competência e descrição → a nota entra na fila (`nfse_mei_notas`, `na_fila`).
     Nota com mesmo tomador, valor e mês pede confirmação.
2. **Robô** (`deploy/robo-parcelamentos/nfse_mei.py`), a cada minuto: entra no portal com o CNPJ e a senha
   (o login com senha **não tem captcha**), preenche Pessoas → Serviço → Valores, clica em **Emitir NFS-e**,
   baixa PDF (DANFSe) e XML para `documentos/nfse-mei/` e manda os dois no WhatsApp do cliente
   (`whatsapp_entrega` ou `telefone`). O escritório recebe o aviso no WhatsApp do robô.
3. Na tela, cada nota mostra o andamento; emitida tem PDF, XML e "mandar de novo no WhatsApp".

`MEI_TRANSMITIR=0` (padrão): o robô preenche e **espera alguém clicar em "Emitir NFS-e" pela tela remota**
(avisa no WhatsApp). Depois das primeiras notas certas, `MEI_TRANSMITIR=1` no `.env` para emitir sozinho.

Nota que travou **depois** do clique em Emitir fica com erro e `talvez_emitida`: "tentar de novo" pede
para conferir no portal antes, para não sair nota em dobro.

## Instalar

1. Supabase: `supabase-schema-nfse-mei.sql` (aplicado em 09/11/2026 pelo `supabase db query --linked`).
2. Netlify: nada novo (usa `NFSE_CERT_KEY`, `SUPABASE_*` e `EVOLUTION_*`, que já existem). Publicar.
3. Servidor do robô: copiar a pasta `deploy/robo-parcelamentos` de novo e rodar `bash robo-parcelamentos/instalar.sh`
   (como na instalação; reconstrói o container). Novas variáveis no `.env`: `MEI_ATIVO=1`, `MEI_TRANSMITIR=0`.
   A `NFSE_CERT_KEY` é opcional (Enter pula): sem ela, o robô pede a senha decifrada à function `nfse-mei`
   com o cabeçalho `x-robo-chave` = `SUPABASE_SERVICE_KEY` (a chave é secreta no Netlify e não dá para copiar).
4. Para cada MEI: cadastrar senha e modelo na tela.

## Calibrar (primeira nota)

O robô acha os campos do portal pelo id/name (padrão ASP.NET `Grupo_Campo`) e pelos rótulos; o formulário
de dentro do portal só é visto depois do login. Para conferir sem emitir:

```
docker compose exec robo python robo.py mei-explorar ID_DA_NOTA
```

Ele para na tela de conferência e guarda print + HTML de cada passo em `/opt/gestor-robo/dados/nfse-mei/<nota>/`.
Se parar num passo, o HTML daquele passo mostra o campo que mudou; ajustar `passo_*` em `nfse_mei.py`.

Comandos: `python robo.py mei` (fila agora), `MEI_ATIVO=0` desliga.

Testes: `node --test netlify/functions/lib/nfse/__tests__/mei.test.cjs` e `python test_nfse_mei.py`.
