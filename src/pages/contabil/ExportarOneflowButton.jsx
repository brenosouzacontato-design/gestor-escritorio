import React, { useState } from 'react';
import { montarLinhasOneflow, gerarPlanilhaOneflow, baixarPlanilhaOneflow } from './exportarOneflow';

// Botão "Exportar p/ OneFlow" da aba Lançamentos — gera a planilha de
// partidas simples do período pra importar no OneFlow (Contábil >
// Lançamentos > Importar lançamentos > Planilha de Lançamentos).
//
// Qual plano a empresa usa no OneFlow fica guardado por empresa neste
// navegador: "Plano Enxuto" (padrão; contas antigas do plano padrão passam
// pelo de-para) ou "Mesmo plano do Gestor" (manda o código como está).
function chaveModo(empresaId) {
  return `oneflow_plano_${empresaId}`;
}
function lerModo(empresaId) {
  try { return localStorage.getItem(chaveModo(empresaId)) || 'enxuto'; } catch { return 'enxuto'; }
}
function gravarModo(empresaId, modo) {
  try { localStorage.setItem(chaveModo(empresaId), modo); } catch { /* sem storage: só não lembra */ }
}

function slug(texto) {
  return (texto || 'empresa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
}

export default function ExportarOneflowButton({ lancamentos, periodo, empresaId, empresaNome }) {
  const [modo, setModo] = useState(() => lerModo(empresaId));
  const [aviso, setAviso] = useState(null);

  function exportar() {
    setAviso(null);
    const { linhas, semConta, pendentes } = montarLinhasOneflow(lancamentos, modo);
    if (semConta.length) {
      setAviso({
        tipo: 'erro',
        texto: `Não exportei: ${semConta.length} conta(s) sem correspondência no Plano Enxuto — ${semConta
          .slice(0, 5).map((c) => `${c.codigo} ${c.nome ?? ''}`).join('; ')}${semConta.length > 5 ? '…' : ''}. Reclassifique ou use "Mesmo plano do Gestor".`,
      });
      return;
    }
    if (!linhas.length) {
      setAviso({ tipo: 'erro', texto: 'Nenhum lançamento no período.' });
      return;
    }
    const wb = gerarPlanilhaOneflow(linhas);
    baixarPlanilhaOneflow(wb, `OneFlow_Lancamentos_${slug(empresaNome)}_${periodo.dataInicio}_a_${periodo.dataFim}.xlsx`);
    setAviso({
      tipo: pendentes ? 'alerta' : 'ok',
      texto: `${linhas.length} linha(s) exportada(s).${pendentes
        ? ` Atenção: ${pendentes} lançamento(s) ainda em "Valores a Identificar" — no OneFlow essa conta trava o fechamento enquanto tiver saldo.`
        : ''}`,
    });
  }

  const cor = aviso?.tipo === 'erro' ? 'var(--danger)' : aviso?.tipo === 'alerta' ? '#b7791f' : 'var(--success, #2f855a)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" className="btn-ghost" onClick={exportar} disabled={!lancamentos?.length}
        title="Gera a planilha de partidas simples para importar no OneFlow">
        Exportar p/ OneFlow
      </button>
      <select value={modo} onChange={(e) => { setModo(e.target.value); gravarModo(empresaId, e.target.value); }}
        title="Plano de contas que esta empresa usa no OneFlow" style={{ fontSize: 12 }}>
        <option value="enxuto">OneFlow: Plano Enxuto</option>
        <option value="mesmo">OneFlow: mesmo plano do Gestor</option>
      </select>
      {aviso && <span style={{ fontSize: 12, color: cor, maxWidth: 420 }}>{aviso.texto}</span>}
    </div>
  );
}
