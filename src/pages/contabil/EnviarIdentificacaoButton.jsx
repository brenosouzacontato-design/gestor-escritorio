import React from 'react';
import { HelpCircleIcon } from 'lucide-react';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Mesmo modelo do CompartilharButton: monta o link público (ver
// IdentificarLancamentosPage.jsx + main.jsx) pros lançamentos ainda não
// identificados do período e abre o WhatsApp com a mensagem já pronta.
export default function EnviarIdentificacaoButton({ empresaId, empresaNome, periodo }) {
  function enviar() {
    const url = `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&inicio=${periodo.dataInicio}&fim=${periodo.dataFim}`;
    const mensagem = `Olá! Pra fechar a contabilidade de ${empresaNome || 'sua empresa'} — período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)} — preciso que você me diga o que foi cada uma dessas movimentações:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  }

  return (
    <button type="button" className="btn-ghost" onClick={enviar}
      style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <HelpCircleIcon size={13} /> Enviar pra identificação
    </button>
  );
}
