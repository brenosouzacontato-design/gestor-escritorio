import { useState } from 'react';
import { useStore } from '../../store';
import './contabil.css';
import PlanoContasTab from './PlanoContasTab';
import LancamentosTab from './LancamentosTab';
import BalanceteTab from './BalanceteTab';
import DRETab from './DRETab';
import ImportarExtratoTab from './ImportarExtratoTab';
import RegrasTab from './RegrasTab';
import PrecificacaoTab from './PrecificacaoTab';

const TABS = [
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'balancete', label: 'Balancete' },
  { id: 'dre', label: 'DRE' },
  { id: 'extrato', label: 'Importar Extrato' },
  { id: 'plano', label: 'Plano de Contas' },
  { id: 'regras', label: 'Regras' },
  { id: 'precificacao', label: 'Precificação' },
];

function primeiroDiaDoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export default function ContabilPage() {
  const clientes = useStore(s => s.clientes)

  const [abaAtiva, setAbaAtiva] = useState('lancamentos');
  const [empresaId, setEmpresaId] = useState(null);
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoMes());
  const [dataFim, setDataFim] = useState(hoje());

  const empresaIdAtual = empresaId ?? clientes[0]?.id ?? null;
  const periodo = { dataInicio, dataFim };

  return (
    <div className="contabil-modulo">
      <div className="contabil-toolbar">
        <select value={empresaIdAtual ?? ''} onChange={(e) => setEmpresaId(e.target.value)}>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
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
          {abaAtiva === 'lancamentos' && <LancamentosTab empresaId={empresaIdAtual} periodo={periodo} />}
          {abaAtiva === 'balancete' && <BalanceteTab empresaId={empresaIdAtual} periodo={periodo} />}
          {abaAtiva === 'dre' && <DRETab empresaId={empresaIdAtual} periodo={periodo} />}
          {abaAtiva === 'extrato' && <ImportarExtratoTab empresaId={empresaIdAtual} />}
          {abaAtiva === 'plano' && <PlanoContasTab empresaId={empresaIdAtual} />}
          {abaAtiva === 'regras' && <RegrasTab empresaId={empresaIdAtual} />}
          {abaAtiva === 'precificacao' && <PrecificacaoTab empresaId={empresaIdAtual} periodo={periodo} />}
        </>
      )}
    </div>
  );
}
