import React, { useState } from 'react';
import { HelpCircleIcon, LinkIcon } from 'lucide-react';
import { useToast } from '../../components/shared';
import { criarLinkIdentificacao } from './contabilApi';

function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Mesmo modelo do CompartilharButton: monta o link público (ver
// IdentificarLancamentosPage.jsx + main.jsx) pra mandar via WhatsApp ou só
// copiar. Sem lancamentoIds (array vazio), manda o período inteiro (todos
// os pendentes de identificação de dataInicio a dataFim) — URL curta, só
// datas, sem round-trip ao banco. Com lancamentoIds (LancamentosTab.jsx
// manda o que está filtrado na tela — busca, conta, natureza, status — ou
// a seleção manual via checkbox, o que for mais específico), a lista fica
// guardada em lancamentos_identificacao_links (criarLinkIdentificacao) e a
// URL leva só o id curto dessa linha — listar um UUID por lançamento direto
// na URL (formato antigo) passava de 10 mil caracteres com uma centena de
// lançamentos.
//
// Um botão só, sempre no mesmo lugar (LancamentosTab.jsx não tem mais um
// segundo botão que aparecia junto com a seleção) — dois botões parecidos
// lado a lado (um sempre manda o período inteiro, o outro só a seleção)
// confundia, e ignorar os filtros da tabela mandava tudo do período mesmo
// com a tela filtrada.
export default function EnviarIdentificacaoButton({ empresaId, empresaNome, periodo, lancamentoIds }) {
  const { show } = useToast();
  const [processando, setProcessando] = useState(false);
  const temFiltro = lancamentoIds && lancamentoIds.length > 0;

  async function montarUrlEMensagem() {
    const url = temFiltro
      ? `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&link=${await criarLinkIdentificacao(empresaId, lancamentoIds)}`
      : `${window.location.origin}${window.location.pathname}?identificar=1&empresa=${empresaId}&inicio=${periodo.dataInicio}&fim=${periodo.dataFim}`;
    const descricaoPeriodo = temFiltro
      ? `${lancamentoIds.length} movimentaç${lancamentoIds.length > 1 ? 'ões' : 'ão'}`
      : `período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`;
    const mensagem = `Olá! Pra fechar a contabilidade de ${empresaNome || 'sua empresa'} — ${descricaoPeriodo} — preciso que você me diga o que foi cada uma dessas movimentações:\n${url}`;
    return { url, mensagem };
  }

  async function enviarWhatsapp() {
    // abre a aba já no clique (o navegador bloqueia popup criado depois de
    // um await, já que perde a associação com o gesto do usuário) e só
    // preenche a URL quando o link (com filtro) estiver pronto
    const janela = window.open('', '_blank');
    setProcessando(true);
    try {
      const { mensagem } = await montarUrlEMensagem();
      if (janela) janela.location.href = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    } catch (e) {
      janela?.close();
      show?.('Não consegui gerar o link: ' + e.message);
    } finally {
      setProcessando(false);
    }
  }

  async function copiarLink() {
    setProcessando(true);
    let url;
    try {
      ({ url } = await montarUrlEMensagem());
    } catch (e) {
      setProcessando(false);
      show?.('Não consegui gerar o link: ' + e.message);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      show?.('Link copiado!');
    } catch {
      show?.('Não consegui copiar automaticamente — copie manualmente: ' + url);
    } finally {
      setProcessando(false);
    }
  }

  const rotulo = temFiltro ? `Enviar ${lancamentoIds.length} lançamento${lancamentoIds.length > 1 ? 's' : ''} pra identificação` : 'Enviar pra identificação';

  return (
    <div style={{ display: 'inline-flex' }}>
      <button type="button" className="btn-ghost" onClick={enviarWhatsapp} disabled={processando}
        style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 5, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>
        <HelpCircleIcon size={13} /> {processando ? 'Gerando link...' : rotulo}
      </button>
      <button type="button" className="btn-ghost" onClick={copiarLink} disabled={processando} title="Copiar link pra compartilhar por fora do WhatsApp"
        style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--border)' }}>
        <LinkIcon size={13} />
      </button>
    </div>
  );
}
