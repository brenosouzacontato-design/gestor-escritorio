import { useState } from 'react';
import { useStore } from '../../store';
import EmpresaCombobox from '../../components/EmpresaCombobox';
import './contabil.css';
import ResumoTab from './ResumoTab';
import LancamentosTab from './LancamentosTab';
import LancarOneflowTab from './LancarOneflowTab';
import ImportarExtratoTab from './ImportarExtratoTab';
import RegrasTab from './RegrasTab';

// Financeiro = ponte entre o extrato e o OneFlow: resumo + lançamentos do
// extrato (importado aqui ou pelo WhatsApp) e o envio pro módulo Contábil do
// OneFlow, onde ficam DRE, balancete e demais demonstrações.
const TABS = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'oneflow', label: 'Lançar no OneFlow' },
  { id: 'extrato', label: 'Importar Extrato' },
  { id: 'regras', label: 'Regras' },
];

function primeiroDiaDoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// clienteFixo: aberta dentro da aba da empresa (EmpresaAbaPage), sem trocar de empresa
export default function ContabilPage({ clienteFixo = null } = {}) {
  const clientes = useStore(s => s.clientes)

  const [abaAtiva, setAbaAtiva] = useState('resumo');
  const [empresaId, setEmpresaId] = useState(clienteFixo);
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoMes());
  const [dataFim, setDataFim] = useState(hoje());

  const empresaIdAtual = empresaId ?? clientes[0]?.id ?? null;
  const periodo = { dataInicio, dataFim };
  const empresaNome = clientes.find((c) => c.id === empresaIdAtual)?.nome;

  return (
    <div className="contabil-modulo">
      <div className="contabil-toolbar">
        {!clienteFixo && <EmpresaCombobox empresas={clientes} value={empresaIdAtual} onChange={setEmpresaId} style={{ minWidth: 260 }} />}
        <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        <span style={{ color: 'var(--text2)' }}>até</span>
        <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
      </div>

      <div className="contabil-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className="contabil-tab"
            data-active={abaAtiva === tab.id}
            onClick={() => setAbaAtiva(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!empresaIdAtual ? (
        <p style={{ color: 'var(--text2)' }}>Selecione uma empresa para começar.</p>
      ) : (
        <>
          {abaAtiva === 'resumo' && <ResumoTab empresaId={empresaIdAtual} periodo={periodo}
            onPeriodo={(p) => { setDataInicio(p.dataInicio); setDataFim(p.dataFim); }} onIrPara={setAbaAtiva} />}
          {abaAtiva === 'lancamentos' && <LancamentosTab empresaId={empresaIdAtual} periodo={periodo} empresaNome={empresaNome} />}
          {abaAtiva === 'oneflow' && <LancarOneflowTab empresaId={empresaIdAtual} periodo={periodo} empresaNome={empresaNome} onIrPara={setAbaAtiva} />}
          {abaAtiva === 'extrato' && <ImportarExtratoTab empresaId={empresaIdAtual} />}
          {abaAtiva === 'regras' && <RegrasTab empresaId={empresaIdAtual} />}
        </>
      )}
    </div>
  );
}
