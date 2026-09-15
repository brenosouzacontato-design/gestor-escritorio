import React from 'react';
import { HelpCircleIcon } from 'lucide-react';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Mesmo modelo do CompartilharButton: monta o link público (ver
// IdentificarLancamentosPage.jsx + main.jsx) e abre o WhatsApp com a
// mensagem já pronta. Sem lancamentoIds, manda o período inteiro (todos os
// pendentes de identificação de dataInicio a dataFim); com lancamentoIds
// (seleção manual feita em LancamentosTab.jsx via checkbox), manda só
// esses — útil quando o cliente já respondeu o resto do período e falta
// perguntar de novo só por um punhado de lançamentos específicos.
export default function EnviarIdentificacaoButton({ empresaId, empresaNome, periodo, lancamentoIds }) {
  const temSelecao = lancamentoIds && lancamentoIds.length > 0;

  function enviar() {
    const url = temSelecao
      ? `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&ids=${lancamentoIds.join(',')}`
      : `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&inicio=${periodo.dataInicio}&fim=${periodo.dataFim}`;
    const descricaoPeriodo = temSelecao
      ? `${lancamentoIds.length} movimentaç${lancamentoIds.length > 1 ? 'ões' : 'ão'} selecionada${lancamentoIds.length > 1 ? 's' : ''}`
      : `período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`;
    const mensagem = `Olá! Pra fechar a contabilidade de ${empresaNome || 'sua empresa'} — ${descricaoPeriodo} — preciso que você me diga o que foi cada uma dessas movimentações:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  }

  return (
    <button type="button" className="btn-ghost" onClick={enviar}
      style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <HelpCircleIcon size={13} /> {temSelecao ? `Enviar ${lancamentoIds.length} selecionado${lancamentoIds.length > 1 ? 's' : ''} pra identificação` : 'Enviar pra identificação'}
    </button>
  );
}
