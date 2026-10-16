import { useEffect, useState } from 'react';
import { supabase, ativarModoPainel, rpcAusente } from '../../lib/supabase';

// Acesso das páginas públicas (painel do cliente e links compartilhados).
// O valor que vem na URL (?painel=, &empresa=) é o token do painel do cliente
// (clientes.painel_token). resolverPainel() liga o modo painel (cabeçalho
// x-painel-token em toda consulta, ver lib/supabase.js) e pergunta ao banco
// de quem é o token — painel_sessao() devolve só as colunas que as páginas
// públicas usam. Ver docs/seguranca-rls.md.
//
// Transição: link antigo (com o id do cliente) ou banco sem o script
// supabase-rls-01-preparacao.sql → lê o cliente pelo id, como antes. Isso só
// funciona enquanto o RLS estiver desligado; depois do passo 2 o link antigo
// cai na mensagem de link inválido.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessoes = new Map();

export function resolverPainel(valor) {
  if (!valor) return Promise.reject(new Error('Link incompleto.'));
  if (!sessoes.has(valor)) {
    ativarModoPainel(valor);
    sessoes.set(valor, (async () => {
      const { data, error } = await supabase.rpc('painel_sessao');
      if (!error && data?.length) return data[0];
      if (error && !rpcAusente(error)) console.warn('painel_sessao:', error.message);
      if (UUID.test(valor)) {
        const { data: legado } = await supabase.from('clientes').select('*').eq('id', valor).maybeSingle();
        if (legado) return legado;
      }
      throw new Error('Link inválido ou expirado. Peça um link novo ao escritório.');
    })());
    // erro não fica em cache: recarregar a página tenta de novo
    sessoes.get(valor).catch(() => sessoes.delete(valor));
  }
  return sessoes.get(valor);
}

// Envolve a página pública: só monta a página depois de saber o cliente, e
// passa pra ela o id de verdade e a "sessao" (dados do cliente).
export default function AcessoPainel({ valor, children }) {
  const [estado, setEstado] = useState({ sessao: null, erro: null });

  useEffect(() => {
    let ativo = true;
    resolverPainel(valor)
      .then((sessao) => ativo && setEstado({ sessao, erro: null }))
      .catch((e) => ativo && setEstado({ sessao: null, erro: e.message }));
    return () => { ativo = false; };
  }, [valor]);

  if (estado.erro) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 14 }}>
        {estado.erro}
      </div>
    );
  }
  if (!estado.sessao) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Carregando...
      </div>
    );
  }
  return children(estado.sessao);
}

// Dados do cliente pras páginas públicas: no painel vêm da sessão (o anônimo
// não lê a tabela clientes); no modo admin (dentro do app) vêm do banco.
export function obterClientePagina(clienteId, sessao, colunas) {
  if (sessao) return Promise.resolve({ data: sessao, error: null });
  return supabase.from('clientes').select(colunas).eq('id', clienteId).single();
}
