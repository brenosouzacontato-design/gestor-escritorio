import React, { useEffect, useState } from 'react';
import AcessoPainel from '../painel/AcessoPainel';
import { calcularBalancete, comSomasDeFilhas, somarRaizes } from './contabilApi';
import { supabase } from '../../lib/supabase';
import { carregarDadosDreGerencialCom, montarDreGerencial } from '../../lib/dreGerencial';
import DreGerencialView from './DreGerencialView';
import BalanceteLista from './BalanceteLista';

const CAMPOS_BALANCETE = ['saldoAnterior', 'debito', 'credito', 'saldoAtual'];

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

const ORDEM_TIPO_BALANCETE = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'custo', 'despesa'];

// Página pública (sem login) pra compartilhar Balancete ou DRE com o
// cliente via link — só leitura, sem sidebar de lançamentos nem edição.
// Acessada via ?share=dre|balancete&empresa=<token do painel>&inicio=&fim= (ver App.jsx,
// que renderiza essa página no lugar do app inteiro quando detecta o param).
// Link público: &empresa= é o token do painel do cliente — resolve antes de
// montar a página (AcessoPainel.jsx).
export default function RelatorioCompartilhadoPage(props) {
  return (
    <AcessoPainel valor={props.empresaId}>
      {(sessao) => <RelatorioCompartilhado {...props} empresaId={sessao.id} sessao={sessao} />}
    </AcessoPainel>
  );
}

function RelatorioCompartilhado({ tipo, empresaId, dataInicio, dataFim, sessao }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [dre, setDre] = useState(null);
  const [balancete, setBalancete] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, resultado] = await Promise.all([
          Promise.resolve({ data: sessao, error: null }),
          tipo === 'dre'
            ? carregarDadosDreGerencialCom(supabase, empresaId, { dataInicio, dataFim }).then(montarDreGerencial)
            : calcularBalancete(empresaId, { dataInicio, dataFim }),
        ]);
        if (errCliente) throw errCliente;
        setEmpresaNome(cliente?.nome ?? '');
        if (tipo === 'dre') setDre(resultado); else setBalancete(resultado);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [tipo, empresaId, dataInicio, dataFim]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: tipo === 'dre' ? 1280 : 900, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {tipo === 'dre' ? 'DRE gerencial mensal' : 'Balancete'}
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>
            Período de {fmtData(dataInicio)} até {fmtData(dataFim)}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && tipo === 'dre' && dre && <DreGerencialView dre={dre} />}

          {!carregando && !erro && tipo === 'balancete' && balancete && (() => {
            const porTipo = ORDEM_TIPO_BALANCETE.map((t) => {
              const doTipo = balancete.filter((l) => l.conta.tipo === t);
              const comSomas = comSomasDeFilhas(doTipo, CAMPOS_BALANCETE);
              const contas = comSomas.filter((l) => l.saldoAnterior !== 0 || l.debito !== 0 || l.credito !== 0 || l.saldoAtual !== 0);
              const total = somarRaizes(comSomas, CAMPOS_BALANCETE);
              return { tipo: t, contas, total };
            }).filter((g) => g.contas.length > 0);

            return <BalanceteLista porTipo={porTipo} />;
          })()}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Relatório gerado pelo Gestor — Escritório Contábil, só pra conferência.
        </div>
      </div>
    </div>
  );
}
