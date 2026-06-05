# Gestor Escritório Contábil

App React + Supabase para gestão de tarefas do escritório com integração ao OneFlow (Omie).

---

## 🚀 Deploy em 10 minutos

### 1. Criar projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) → New Project
2. Anote a **URL** e a **anon key** (Settings → API)
3. Abra o **SQL Editor** e cole o conteúdo de `supabase-schema.sql` → Run

### 2. Configurar variáveis de ambiente

Copie `.env.example` para `.env`:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
```

### 3. Rodar localmente

```bash
npm install
npm run dev
```

### 4. Deploy no Netlify (gratuito)

**Opção A — via GitHub:**
1. Suba este projeto para um repositório GitHub
2. Em [app.netlify.com](https://app.netlify.com) → Add new site → Import from Git
3. Build command: `npm run build` | Publish directory: `dist`
4. Em Site settings → Environment variables, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

**Opção B — Netlify CLI:**
```bash
npm install -g netlify-cli
netlify init
netlify env:set VITE_SUPABASE_URL https://...
netlify env:set VITE_SUPABASE_ANON_KEY eyJ...
netlify deploy --build --prod
```

---

## 🔑 Configurar token OneFlow

Após subir o app:

1. Clique em ⚙️ Configurações → **Conector OneFlow**
2. Escolha uma das opções:
   - **Token manual:** acesse `app.omie.com.br/api/portal/users/me/token/` logado como usuário de integração e cole o token
   - **Login automático:** informe e-mail + senha do usuário de integração
3. Vá para a aba **Vincular** → clique em **Sincronizar empresas do OneFlow**
   - O app lista todas as empresas do escritório e vincula automaticamente pelos CNPJs cadastrados

### Fluxo de autenticação OneFlow

```
Usuário → Token (24h) → Hash do escritório → Token do escritório
                      → Hash por empresa  → Token por empresa → APIs de folha/fiscal
```

O token expira em 24h. A renovação automática é feita pelo app usando o `refresh_token`.

---

## 📱 Funcionalidades

| Módulo | Descrição |
|---|---|
| Visão Geral | Métricas, tarefas urgentes, status por cliente |
| Tarefas | Filtro por dept e cliente, marcar concluída, excluir |
| Clientes | Lista com status, detalhe com tarefas por departamento + ERP |
| Fechamentos ERP | Sincronização real com OneFlow por competência |
| Configurações | Token JWT, renovação automática, vincular empresas |

### Departamentos
- **Fiscal** — PGDAS, DCTFWeb, NFS-e, guias
- **Pessoal** — Folha, eSocial, admissão, rescisão
- **Societário** — JUCEMG, alvará, certidões
- **Contábil** — Extrato, conciliação, lançamentos
- **Comunicação** — Envio de relatórios, cobranças

---

## 🗄️ Banco de dados (Supabase)

| Tabela | Descrição |
|---|---|
| `clientes` | Cadastro + tokens OneFlow por empresa |
| `tarefas` | Tarefas manuais e originadas do ERP |
| `fechamentos_erp` | Cache dos fechamentos sincronizados |
| `configuracoes` | Tokens globais do escritório |

---

## 🔧 Tecnologias

- **React 18** + Vite
- **Supabase** (PostgreSQL + REST)
- **Zustand** (estado global)
- **lucide-react** (ícones)
- **DM Sans** + **DM Mono** (tipografia)
