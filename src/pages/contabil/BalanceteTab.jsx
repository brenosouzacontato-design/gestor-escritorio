import React, { useEffect, useState, useCallback } from 'react';
import { calcularBalancete, listarLancamentosPorConta, listarContasTodasGerenciamento, comSomasDeFilhas, somarRaizes } from './contabilApi';
import ContaLancamentosSidebar from './ContaLancamentosSidebar';
import CompartilharButton from './CompartilharButton';
import BalanceteLista from './BalanceteLista';

const CAMPOS_BALANCETE = ['saldoAnterior', 'debito', 'credito', 'saldoAtual'];

const ORDEM_TIPO = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'custo', 'despesa'];

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
  // ver criarContaFilha) com a soma de tudo embaixo dela; filhas aparecem
  // primeiro, indentadas, com o valor próprio delas, e a soma sintética
  // fecha o grupo por último. O total do grupo (conta sintética "Total
  // Ativo" etc) soma só as raízes — cada uma já carrega a soma dela +
  // filhas, então somar tudo contaria filha duas vezes.
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

      <BalanceteLista porTipo={porTipo} onClickConta={abrirConta} />

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
