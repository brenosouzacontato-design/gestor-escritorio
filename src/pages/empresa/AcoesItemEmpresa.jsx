// Ações de obrigação/tarefa dentro da aba da empresa (EmpresaAbaPage) — as
// mesmas do card da empresa no Fechamento (Empresas.jsx): dar baixa, anexar,
// atribuir e lembrete. Reaproveita os modais de lá; aqui só junta o estado
// (anexos e lembretes da empresa) num hook pra a aba toda.
import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, UndoIcon, BellIcon, BellRingIcon, UserIcon } from 'lucide-react'
import { useStore } from '../../store'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/shared'
import { BotaoAnexos, AnexosItemModal } from '../../components/AnexosItem'
import ModalLembrete from '../../components/ModalLembrete'
import { ModalAtribuir } from '../andamento/modaisObrigacao'
import { listarLembretesPorItens } from '../andamento/lembretesApi'
import { listarDocumentosPorCliente, anexarDocumentoAoItem, abrirLinkAssinado } from '../documentos/documentosApi'

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

  const anexosDoItem = (tipo, id) => anexos.filter((d) => (tipo === 'obrigacao' ? d.obrigacao_id : d.tarefa_id) === id)
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
    anexosDoItem, lembreteDoItem, baixar, ocupado, modais,
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

// Ícones de ação de um item: ✓ baixa · 📎 anexar · 👤 atribuir · 🔔 lembrete
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
    </span>
  )
}
