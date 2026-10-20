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
- [ ] Fases 4 (WhatsApp) e 5 (recorrentes).
