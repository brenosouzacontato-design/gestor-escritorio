import React, { useEffect, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listarLancamentosAIdentificar } from './contabilApi';
import LancamentosIdentificar from './LancamentosIdentificar';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Página pública (sem login) pra mandar pro cliente a lista de lançamentos
// que ainda não foram identificados (mesma conta transitória "Valores a
// Identificar" usada na importação de extrato). Cabeçalho com cards de
// resumo, tabela dos pendentes com popup de identificação e cards dos já
// identificados — tudo isso vem de LancamentosIdentificar.jsx, o mesmo
// componente usado na aba Contábil do Painel do cliente. Acessada via
// ?identificar=1&empresa=<id>&inicio=&fim= (ver main.jsx).
export default function IdentificarLancamentosPage({ empresaId, dataInicio, dataFim }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const carregar = async () => {
    setErro(null);
    try {
      const [{ data: cliente, error: errCliente }, itens] = await Promise.all([
        supabase.from('clientes').select('nome').eq('id', empresaId).single(),
        listarLancamentosAIdentificar(empresaId, { dataInicio, dataFim }),
      ]);
      if (errCliente) throw errCliente;
      setEmpresaNome(cliente?.nome ?? '');
      setLancamentos(itens);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar() }, [empresaId, dataInicio, dataFim]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Lançamentos a identificar
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>
            Período de {fmtData(dataInicio)} até {fmtData(dataFim)}
          </div>
        </div>

        <div style={{ padding: '16px 24px 6px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Clique no ícone <PencilIcon size={11} style={{ verticalAlign: -1 }} /> ao lado de cada lançamento pra dizer o que foi essa movimentação
          (ex: "pagamento de fornecedor X", "recebimento do cliente Y"). Salva assim que você confirmar, sem precisar terminar tudo de uma vez.
        </div>

        <div style={{ padding: '10px 24px 24px' }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && lancamentos.length === 0 && (
            <p style={{ color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>
              Nenhum lançamento pendente de identificação nesse período.
            </p>
          )}

          {lancamentos.length > 0 && (
            <LancamentosIdentificar lancamentos={lancamentos} onSaved={carregar} />
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Enviado pelo Gestor — Escritório Contábil, pra ajudar a identificar movimentações do extrato.
        </div>
      </div>
    </div>
  );
}
