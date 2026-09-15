import React from 'react';
import { HelpCircleIcon, LinkIcon } from 'lucide-react';
import { useToast } from '../../components/shared';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Mesmo modelo do CompartilharButton: monta o link público (ver
// IdentificarLancamentosPage.jsx + main.jsx) pra mandar via WhatsApp ou só
// copiar. Sem lancamentoIds, manda o período inteiro (todos os pendentes de
// identificação de dataInicio a dataFim); com lancamentoIds (seleção manual
// feita em LancamentosTab.jsx via checkbox), manda só esses — útil quando o
// cliente já respondeu o resto do período e falta perguntar de novo só por
// um punhado de lançamentos específicos.
//
// Um botão só, sempre no mesmo lugar (LancamentosTab.jsx não tem mais um
// segundo botão que aparecia junto com a seleção) — dois botões parecidos
// lado a lado (um sempre manda o período inteiro, o outro só a seleção)
// dava pra clicar no errado sem perceber e "a seleção não fazia efeito".
export default function EnviarIdentificacaoButton({ empresaId, empresaNome, periodo, lancamentoIds }) {
  const { show } = useToast();
  const temSelecao = lancamentoIds && lancamentoIds.length > 0;

  function montarUrlEMensagem() {
    const url = temSelecao
      ? `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&ids=${lancamentoIds.join(',')}`
      : `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&inicio=${periodo.dataInicio}&fim=${periodo.dataFim}`;
    const descricaoPeriodo = temSelecao
      ? `${lancamentoIds.length} movimentaç${lancamentoIds.length > 1 ? 'ões' : 'ão'} selecionada${lancamentoIds.length > 1 ? 's' : ''}`
      : `período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`;
    const mensagem = `Olá! Pra fechar a contabilidade de ${empresaNome || 'sua empresa'} — ${descricaoPeriodo} — preciso que você me diga o que foi cada uma dessas movimentações:\n${url}`;
    return { url, mensagem };
  }

  function enviarWhatsapp() {
    const { mensagem } = montarUrlEMensagem();
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  }

  async function copiarLink() {
    const { url } = montarUrlEMensagem();
    try {
      await navigator.clipboard.writeText(url);
      show?.('Link copiado!');
    } catch {
      show?.('Não consegui copiar automaticamente — copie manualmente: ' + url);
    }
  }

  const rotulo = temSelecao ? `Enviar ${lancamentoIds.length} selecionado${lancamentoIds.length > 1 ? 's' : ''} pra identificação` : 'Enviar pra identificação';

  return (
    <div style={{ display: 'inline-flex' }}>
      <button type="button" className="btn-ghost" onClick={enviarWhatsapp}
        style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 5, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>
        <HelpCircleIcon size={13} /> {rotulo}
      </button>
      <button type="button" className="btn-ghost" onClick={copiarLink} title="Copiar link pra compartilhar por fora do WhatsApp"
        style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--border)' }}>
        <LinkIcon size={13} />
      </button>
    </div>
  );
}
