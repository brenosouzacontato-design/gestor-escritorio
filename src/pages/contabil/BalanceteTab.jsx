import React, { useEffect, useState, useCallback } from 'react';
import { calcularBalancete, listarLancamentosPorConta, listarContasTodasGerenciamento, comSomasDeFilhas, somarRaizes } from './contabilApi';
import ContaLancamentosSidebar from './ContaLancamentosSidebar';
import CompartilharButton from './CompartilharButton';

const CAMPOS_BALANCETE = ['saldoAnterior', 'debito', 'credito', 'saldoAtual'];

const LABEL_TIPO = {
  ativo: 'Ativo',
  passivo: 'Passivo',
  patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receitas',
  despesa: 'Despesas',
  custo: 'Custos',
};

const ORDEM_TIPO = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'custo', 'despesa'];

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BalanceteTab({ empresaId, periodo, empresaNome }) {
  const [linhas, setLinhas] = useState([]);
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [sidebar, setSidebar] = useState(null); // { conta, lancamentos, carregando, saldoAnterior }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await calcularBalancete(empresaId, periodo);
      setLinhas(resultado);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);
  // só contas analíticas (aceita_lancamento) entram como opção de
  // contrapartida no razão — contas sintéticas não recebem lançamento direto
  useEffect(() => { listarContasTodasGerenciamento(empresaId).then((c) => setContas(c.filter((x) => x.aceita_lancamento))).catch(() => {}); }, [empresaId]);

  async function abrirConta(conta, saldoAnterior = 0) {
    setSidebar({ conta, lancamentos: [], carregando: true, saldoAnterior });
    try {
      const lancamentos = await listarLancamentosPorConta(empresaId, conta.id, periodo);
      setSidebar({ conta, lancamentos, carregando: false, saldoAnterior });
    } catch (e) {
      setErro(e.message);
      setSidebar(null);
    }
  }

  async function recarregarSidebar() {
    if (!sidebar) return;
    try {
      const lancamentos = await listarLancamentosPorConta(empresaId, sidebar.conta.id, periodo);
      setSidebar((prev) => (prev ? { ...prev, lancamentos } : prev));
    } catch (e) {
      setErro(e.message);
    }
    carregar();
  }

  if (carregando) return <p>Calculando balancete...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;

  // comSomasDeFilhas agrupa a conta-pai (se tiver filhas via conta_pai_id —
  // ver criarContaFilha) com a soma de tudo embaixo dela; filhas continuam
  // listadas indentadas com o valor próprio delas. O total do grupo (conta
  // sintética "Total Ativo" etc) soma só as raízes — cada uma já carrega a
  // soma dela + filhas, então somar tudo contaria filha duas vezes.
  const porTipo = ORDEM_TIPO.map((tipo) => {
    const doTipo = linhas.filter((l) => l.conta.tipo === tipo);
    const comSomas = comSomasDeFilhas(doTipo, CAMPOS_BALANCETE);
    const contas = comSomas.filter((l) => l.saldoAnterior !== 0 || l.debito !== 0 || l.credito !== 0 || l.saldoAtual !== 0);
    const total = somarRaizes(comSomas, CAMPOS_BALANCETE);
    return { tipo, contas, total };
  }).filter((g) => g.contas.length > 0);

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <CompartilharButton tipo="balancete" empresaId={empresaId} empresaNome={empresaNome} periodo={periodo} />
      </div>

      {porTipo.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {porTipo.map((grupo) => (
            <div key={grupo.tipo} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '8px 14px', minWidth: 150 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>
                Total {LABEL_TIPO[grupo.tipo]}
              </div>
              <div className={`num ${grupo.total.saldoAtual < 0 ? 'valor-negativo' : ''}`} style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                {fmt(grupo.total.saldoAtual)}
              </div>
            </div>
          ))}
        </div>
      )}

      <table className="contabil-tabela">
        <thead>
          <tr>
            <th>Conta</th>
            <th className="num">Saldo Anterior</th>
            <th className="num">Débito</th>
            <th className="num">Crédito</th>
            <th className="num">Saldo Atual</th>
          </tr>
        </thead>
        <tbody>
          {porTipo.map((grupo) => (
            <React.Fragment key={grupo.tipo}>
              <tr className="grupo-row">
                <td colSpan={5}>{LABEL_TIPO[grupo.tipo]}</td>
              </tr>
              {grupo.contas.map((l) => (
                <tr key={l.conta.id} onClick={() => abrirConta(l.conta, l.saldoAnterior)} style={{ cursor: 'pointer', fontWeight: l.temFilhas ? 700 : 400 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                  <td style={{ paddingLeft: 24 + l.nivelExibicao * 18 }}>
                    {l.nivelExibicao > 0 ? '↳ ' : ''}{l.conta.codigo} - {l.conta.nome}
                  </td>
                  <td className="num">{fmt(l.saldoAnterior)}</td>
                  <td className="num">{fmt(l.debito)}</td>
                  <td className="num">{fmt(l.credito)}</td>
                  <td className={`num ${l.saldoAtual < 0 ? 'valor-negativo' : ''}`}>{fmt(l.saldoAtual)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '1px solid var(--border)' }}>
                <td>Total {LABEL_TIPO[grupo.tipo]}</td>
                <td className="num">{fmt(grupo.total.saldoAnterior)}</td>
                <td className="num">{fmt(grupo.total.debito)}</td>
                <td className="num">{fmt(grupo.total.credito)}</td>
                <td className={`num ${grupo.total.saldoAtual < 0 ? 'valor-negativo' : ''}`}>{fmt(grupo.total.saldoAtual)}</td>
              </tr>
            </React.Fragment>
          ))}
          {porTipo.length === 0 && (
            <tr><td colSpan={5} style={{ color: 'var(--text2)' }}>Nenhuma movimentação no período.</td></tr>
          )}
        </tbody>
      </table>

      {sidebar && (
        <ContaLancamentosSidebar
          conta={sidebar.conta}
          lancamentos={sidebar.lancamentos}
          carregando={sidebar.carregando}
          saldoAnterior={sidebar.saldoAnterior}
          contas={contas}
          onClose={() => setSidebar(null)}
          periodo={periodo}
          empresaNome={empresaNome}
          onAlterado={recarregarSidebar}
          onContaAtualizada={(contaAtualizada) => {
            setSidebar((prev) => (prev ? { ...prev, conta: { ...prev.conta, ...contaAtualizada } } : prev));
            carregar();
          }}
        />
      )}
    </>
  );
}
