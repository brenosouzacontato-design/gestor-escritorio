import React from 'react';
import { Share2Icon } from 'lucide-react';
import { chavePainelPorId, urlPublica } from '../../lib/linksPublicos';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Monta o link público (ver RelatorioCompartilhadoPage.jsx + main.jsx) e
// abre o WhatsApp com a mensagem já preenchida, pronta pra escolher o
// contato e mandar — é só compartilhar o link, não precisa saber o
// telefone do cliente aqui.
export default function CompartilharButton({ tipo, empresaId, empresaNome, periodo }) {
  async function compartilhar() {
    // abre a aba no clique (pop-up criado depois de um await é bloqueado) e só
    // preenche quando o token do painel da empresa (vai no link) chegar
    const janela = window.open('', '_blank');
    try {
      const url = urlPublica({ share: tipo, empresa: await chavePainelPorId(empresaId), inicio: periodo.dataInicio, fim: periodo.dataFim });
      const label = tipo === 'dre' ? 'a DRE' : 'o Balancete';
      const mensagem = `Olá! Segue ${label} de ${empresaNome || 'sua empresa'} — período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)} — pra conferência:\n${url}`;
      const destino = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
      if (janela) janela.location.href = destino; else window.open(destino, '_blank');
    } catch (e) {
      janela?.close();
    }
  }

  return (
    <button type="button" className="btn-ghost" onClick={compartilhar}
      style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Share2Icon size={13} /> Compartilhar via WhatsApp
    </button>
  );
}
