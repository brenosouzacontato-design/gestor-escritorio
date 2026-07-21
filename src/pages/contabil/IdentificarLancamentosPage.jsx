import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { listarLancamentosAIdentificar, salvarObservacaoCliente } from './contabilApi';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Página pública (sem login) pra mandar pro cliente a lista de lançamentos
// que ainda não foram identificados (mesma conta transitória "Valores a
// Identificar" usada na importação de extrato) — ele escreve o que foi cada
// um num campo de observação, que salva sozinho ao sair do campo (sem
// precisar de botão "enviar" — assim que ele preenche já fica salvo, não
// corre risco de perder a resposta se ele fechar a aba antes de terminar).
// Acessada via ?identificar=1&empresa=<id>&inicio=&fim= (ver main.jsx).
export default function IdentificarLancamentosPage({ empresaId, dataInicio, dataFim }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
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
    })();
  }, [empresaId, dataInicio, dataFim]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: '#1B2B4B' }}>
          <div style={{ fontSize: 11, color: '#8fadd4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Lançamentos a identificar
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: '#8fadd4', marginTop: 2 }}>
            Período de {fmtData(dataInicio)} até {fmtData(dataFim)}
          </div>
        </div>

        <div style={{ padding: '16px 24px 6px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Escreva embaixo de cada lançamento o que foi essa movimentação (ex: "pagamento de fornecedor X", "recebimento do cliente Y").
          Assim que você sai do campo, a resposta já fica salva automaticamente.
        </div>

        <div style={{ padding: '10px 24px 24px' }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && lancamentos.length === 0 && (
            <p style={{ color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>
              Nenhum lançamento pendente de identificação nesse período.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lancamentos.map((l) => (
              <LinhaIdentificar key={l.id} lancamento={l} />
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Enviado pelo Gestor — Escritório Contábil, pra ajudar a identificar movimentações do extrato.
        </div>
      </div>
    </div>
  );
}

function LinhaIdentificar({ lancamento }) {
  const [observacao, setObservacao] = useState(lancamento.observacaoCliente);
  const [status, setStatus] = useState('idle'); // idle | salvando | salvo | erro

  async function salvar() {
    if (observacao === lancamento.observacaoCliente) return;
    setStatus('salvando');
    try {
      await salvarObservacaoCliente(lancamento.id, observacao);
      lancamento.observacaoCliente = observacao;
      setStatus('salvo');
    } catch {
      setStatus('erro');
    }
  }

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtData(lancamento.data)}</span>
        <span style={{ fontSize: 13, fontWeight: 700,
          color: lancamento.natureza === 'saida' ? 'var(--danger)' : lancamento.natureza === 'entrada' ? 'var(--ok)' : 'var(--text1)' }}>
          {lancamento.natureza === 'entrada' ? '+ ' : lancamento.natureza === 'saida' ? '− ' : ''}{fmt(lancamento.valor)}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text1)', marginTop: 4, fontWeight: 500 }}>{lancamento.historico}</div>
      <textarea
        value={observacao}
        onChange={(e) => { setObservacao(e.target.value); setStatus('idle'); }}
        onBlur={salvar}
        placeholder="O que foi esse lançamento?"
        rows={2}
        style={{ width: '100%', marginTop: 8, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8,
          fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical' }}
      />
      {status === 'salvando' && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>Salvando...</div>}
      {status === 'salvo' && <div style={{ fontSize: 10.5, color: 'var(--ok)', marginTop: 3 }}>✓ Salvo</div>}
      {status === 'erro' && <div style={{ fontSize: 10.5, color: 'var(--danger)', marginTop: 3 }}>Erro ao salvar, tente de novo.</div>}
    </div>
  );
}
