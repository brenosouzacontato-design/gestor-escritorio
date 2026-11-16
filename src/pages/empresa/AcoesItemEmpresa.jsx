// Ações de obrigação/tarefa dentro da aba da empresa (EmpresaAbaPage) — as
// mesmas do card da empresa no Fechamento (Empresas.jsx): dar baixa, anexar,
// atribuir, lembrete e excluir obrigação. Reaproveita os modais de lá; aqui só
// junta o estado (anexos e lembretes da empresa) num hook pra a aba toda.
// O vencimento de uma obrigação com guia anexada é o da guia (lido pela IA,
// como no painel do cliente — extrair-valor-guia.js lê cada guia uma vez).
import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, UndoIcon, BellIcon, BellRingIcon, UserIcon, Trash2Icon } from 'lucide-react'
import { useStore } from '../../store'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/shared'
import { BotaoAnexos, AnexosItemModal } from '../../components/AnexosItem'
import ModalLembrete from '../../components/ModalLembrete'
import { ModalAtribuir } from '../andamento/modaisObrigacao'
import { listarLembretesPorItens } from '../andamento/lembretesApi'
import { listarDocumentosPorCliente, anexarDocumentoAoItem, abrirLinkAssinado, substituirAnexoDoItem } from '../documentos/documentosApi'
import { extrairValorGuia } from '../painel/painelApi'

const feita = (o) => o.status === 'concluido' || o.status === 'nao_aplica'

// obrigacaoIds / tarefaIds: os itens que aparecem na aba (pra achar os lembretes)
export function useAcoesEmpresa(cliente, obrigacaoIds, tarefaIds) {
  const { show } = useToast()
  const fetchObrigacoes = useStore((s) => s.fetchObrigacoes)
  const toggleTarefa = useStore((s) => s.toggleTarefa)
  const fetchTarefas = useStore((s) => s.fetchTarefas)
  const [anexos, setAnexos] = useState([])
  const [lembretes, setLembretes] = useState([])
  const [anexoAlvo, setAnexoAlvo] = useState(null) // { tipo, item }
  const [lembreteAlvo, setLembreteAlvo] = useState(null) // { obrigacaoId|tarefaId, titulo, lembrete }
  const [atribuirAlvo, setAtribuirAlvo] = useState(null) // { obrigacaoId|tarefaId, titulo, responsavel }
  const [ocupado, setOcupado] = useState(null) // id do item sendo baixado

  const clienteId = cliente?.id
  const recarregarAnexos = useCallback(() => {
    if (!clienteId) return Promise.resolve()
    return listarDocumentosPorCliente(clienteId).then((d) => setAnexos(d || [])).catch(() => setAnexos([]))
  }, [clienteId])
  useEffect(() => { recarregarAnexos() }, [recarregarAnexos])

  const chaveLembretes = `${obrigacaoIds.join()}|${tarefaIds.join()}`
  const recarregarLembretes = useCallback(() =>
    listarLembretesPorItens({ obrigacaoIds, tarefaIds }).then(setLembretes).catch(() => setLembretes([])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [chaveLembretes])
  useEffect(() => { recarregarLembretes() }, [recarregarLembretes])

  // Guias anexadas às obrigações da aba que a IA ainda não leu (vencimento/valor):
  // lê cada uma uma vez. Só com a coluna valor_guia_extraido_em no banco.
  const chaveObrigacoes = obrigacaoIds.join()
  const [lendo, setLendo] = useState(() => new Set())
  useEffect(() => {
    const ids = new Set(obrigacaoIds)
    const pendentes = anexos.filter((d) => ids.has(d.obrigacao_id) && 'valor_guia_extraido_em' in d && !d.valor_guia_extraido_em
      && /pdf/i.test(d.tipo_mime || d.nome_arquivo || '') && !lendo.has(d.id)).slice(0, 6)
    if (!pendentes.length) return
    setLendo((l) => new Set([...l, ...pendentes.map((d) => d.id)]))
    pendentes.forEach((d) => extrairValorGuia(d.id)
      .then((r) => setAnexos((lista) => lista.map((a) => (a.id === d.id
        ? { ...a, valor_guia: r.valor, vencimento_guia: r.vencimento, valor_guia_extraido_em: new Date().toISOString() } : a))))
      .catch(() => {}))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anexos, chaveObrigacoes])

  const anexosDoItem = (tipo, id) => anexos.filter((d) => (tipo === 'obrigacao' ? d.obrigacao_id : d.tarefa_id) === id)
  // vencimento da guia anexada (a mais recente que tem vencimento lido), ou null
  const vencimentoGuia = (obrigacaoId) => anexos.find((d) => d.obrigacao_id === obrigacaoId && d.vencimento_guia)?.vencimento_guia || null
  const vencimentoDe = (o) => vencimentoGuia(o.id) || o.vencimento || null
  const lembreteDoItem = (tipo, id) => lembretes.find((l) => (tipo === 'obrigacao' ? l.obrigacao_id : l.tarefa_id) === id)

  // Baixa: obrigação vira "concluído" (ou volta pra pendente); tarefa alterna concluída
  const baixar = async (tipo, item) => {
    setOcupado(item.id)
    try {
      if (tipo === 'tarefa') {
        await toggleTarefa(item.id)
        show?.(item.concluida ? 'Tarefa reaberta' : 'Tarefa concluída')
      } else {
        const novo = feita(item) ? 'pendente' : 'concluido'
        const { error } = await supabase.from('obrigacoes').update({ status: novo, updated_at: new Date().toISOString() }).eq('id', item.id)
        if (error) throw error
        await fetchObrigacoes()
        show?.(novo === 'concluido' ? `Baixa feita: ${item.titulo || item.tipo}` : `${item.titulo || item.tipo} voltou para pendente`)
      }
    } catch (e) { show?.('Não foi possível dar a baixa: ' + e.message) }
    setOcupado(null)
  }

  // Excluir obrigação (como no card da empresa no Fechamento): os documentos
  // ligados a ela ficam, só soltam o vínculo (a FK de documentos não tem cascade).
  const excluir = async (item) => {
    const nome = item.titulo || item.tipo
    if (!window.confirm(`Excluir a obrigação "${nome}" (${item.competencia}) de ${cliente?.nome || 'esta empresa'}?\n\nSe ela for recorrente, "Gerar" cria de novo — pra não gerar mais, marque "não aplica" ou tire no cadastro da empresa.`)) return
    setOcupado(item.id)
    try {
      const { error: errDoc } = await supabase.from('documentos').update({ obrigacao_id: null, etapa_obrigacao_id: null }).eq('obrigacao_id', item.id)
      if (errDoc) throw errDoc
      const { error } = await supabase.from('obrigacoes').delete().eq('id', item.id)
      if (error) throw error
      await Promise.all([fetchObrigacoes(), recarregarAnexos()])
      show?.(`Obrigação "${nome}" excluída`)
    } catch (e) { show?.('Erro ao excluir obrigação: ' + (e.message || e)) }
    setOcupado(null)
  }

  const enviarAnexo = async (arquivo, { darBaixa }) => {
    await anexarDocumentoAoItem({ clienteId, alvo: { tipo: anexoAlvo.tipo, id: anexoAlvo.item.id }, arquivo, darBaixa })
    await recarregarAnexos()
    if (darBaixa) await (anexoAlvo.tipo === 'obrigacao' ? fetchObrigacoes() : fetchTarefas())
    show?.(`Documento anexado${darBaixa ? ' e baixa aplicada' : ''}`)
  }

  const modais = (
    <>
      {anexoAlvo && (
        <AnexosItemModal
          titulo={anexoAlvo.item.titulo || anexoAlvo.item.tipo}
          subtitulo={`${anexoAlvo.tipo === 'obrigacao' ? 'Obrigação' : 'Tarefa'} · ${cliente?.nome || ''}`}
          anexos={anexosDoItem(anexoAlvo.tipo, anexoAlvo.item.id)}
          concluido={anexoAlvo.tipo === 'obrigacao' ? feita(anexoAlvo.item) : !!anexoAlvo.item.concluida}
          onEnviar={enviarAnexo}
          onSubstituir={async (anexo, arquivo) => {
            await substituirAnexoDoItem({ clienteId, anexo, arquivo })
            await recarregarAnexos()
            show?.('Anexo substituído')
          }}
          onAbrir={(doc) => abrirLinkAssinado(doc.storage_path).catch((e) => show?.('Erro: ' + e.message))}
          onClose={() => setAnexoAlvo(null)}
        />
      )}
      {lembreteAlvo && (
        <ModalLembrete alvo={lembreteAlvo} onClose={() => setLembreteAlvo(null)}
          onSaved={async () => { setLembreteAlvo(null); await recarregarLembretes() }} />
      )}
      {atribuirAlvo && (
        <ModalAtribuir alvo={atribuirAlvo} onClose={() => setAtribuirAlvo(null)}
          onSaved={async () => { const ob = !!atribuirAlvo.obrigacaoId; setAtribuirAlvo(null); await (ob ? fetchObrigacoes() : fetchTarefas()) }} />
      )}
    </>
  )

  return {
    anexosDoItem, lembreteDoItem, vencimentoGuia, vencimentoDe, baixar, excluir, ocupado, modais,
    abrirAnexos: (tipo, item) => setAnexoAlvo({ tipo, item }),
    abrirLembrete: (tipo, item) => setLembreteAlvo({
      [tipo === 'obrigacao' ? 'obrigacaoId' : 'tarefaId']: item.id, titulo: item.titulo || item.tipo, lembrete: lembreteDoItem(tipo, item.id),
    }),
    abrirAtribuir: (tipo, item) => setAtribuirAlvo({
      [tipo === 'obrigacao' ? 'obrigacaoId' : 'tarefaId']: item.id, titulo: item.titulo || item.tipo, responsavel: item.responsavel,
    }),
  }
}

const botao = (cor) => ({
  background: 'none', border: 'none', cursor: 'pointer', padding: 3, borderRadius: 5, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', color: cor,
})

// Ícones de ação de um item: 📎 anexar · 👤 atribuir · 🔔 lembrete · ✓ baixa · 🗑 excluir (obrigação)
export function AcoesItem({ tipo, item, acoes }) {
  const concluido = tipo === 'obrigacao' ? feita(item) : !!item.concluida
  const lembrete = acoes.lembreteDoItem(tipo, item.id)
  const parar = (fn) => (e) => { e.stopPropagation(); fn() }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <BotaoAnexos qtd={acoes.anexosDoItem(tipo, item.id).length} tamanho={13} onClick={() => acoes.abrirAnexos(tipo, item)} />
      <button type="button" style={botao(item.responsavel ? 'var(--accent)' : 'var(--text3)')}
        title={item.responsavel ? `Atribuída a ${item.responsavel}` : 'Atribuir a alguém'} onClick={parar(() => acoes.abrirAtribuir(tipo, item))}>
        <UserIcon size={13} />
      </button>
      <button type="button" style={botao(lembrete ? 'var(--accent)' : 'var(--text3)')}
        title={lembrete ? `Lembrete pra ${new Date(lembrete.data_hora).toLocaleString('pt-BR')}` : 'Marcar lembrete'}
        onClick={parar(() => acoes.abrirLembrete(tipo, item))}>
        {lembrete ? <BellRingIcon size={13} /> : <BellIcon size={13} />}
      </button>
      <button type="button" disabled={acoes.ocupado === item.id}
        style={{ ...botao(concluido ? 'var(--text3)' : 'var(--ok)'), border: `1px solid ${concluido ? 'var(--border)' : 'var(--ok)'}`, padding: '2px 7px', gap: 3, fontSize: 11, fontWeight: 700, marginLeft: 3, opacity: acoes.ocupado === item.id ? 0.5 : 1 }}
        title={concluido ? 'Desfazer a baixa' : tipo === 'obrigacao' ? 'Dar baixa (concluída)' : 'Concluir tarefa'}
        onClick={parar(() => acoes.baixar(tipo, item))}>
        {concluido ? <><UndoIcon size={12} /> Reabrir</> : <><CheckIcon size={12} /> Baixar</>}
      </button>
      {tipo === 'obrigacao' && (
        <button type="button" disabled={acoes.ocupado === item.id} style={{ ...botao('var(--text3)'), marginLeft: 2 }}
          title="Excluir obrigação" onClick={parar(() => acoes.excluir(item))}>
          <Trash2Icon size={13} />
        </button>
      )}
    </span>
  )
}
