import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useStore = create((set, get) => ({
  clientes: [],
  tarefas: [],
  fechamentos: [],
  obrigacoes: [],
  loading: false,
  oneflowConfig: {
    userToken: '', refreshToken: '', escritorioToken: '',
    escritorioHash: '', tokenExpiresAt: null, configurado: false,
  },

  // ── Clientes ─────────────────────────────────────────────────────────────────
  fetchClientes: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('clientes').select('*').eq('ativo', true).order('nome')
    if (!error) set({ clientes: data || [] })
    set({ loading: false })
  },

  addCliente: async (cliente) => {
    const { data, error } = await supabase.from('clientes').insert(cliente).select().single()
    if (!error) set(s => ({ clientes: [...s.clientes, data] }))
    return { data, error }
  },

  updateCliente: async (id, updates) => {
    const { data, error } = await supabase.from('clientes')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (!error) set(s => ({ clientes: s.clientes.map(c => c.id === id ? data : c) }))
    return { data, error }
  },

  deleteCliente: async (id) => {
    const { error } = await supabase.from('clientes').update({ ativo: false }).eq('id', id)
    if (!error) set(s => ({ clientes: s.clientes.filter(c => c.id !== id) }))
    return { error }
  },

  syncEmpresasOneFlow: async (empresas) => {
    if (!empresas?.length) return { error: 'Nenhuma empresa recebida' }
    const registros = empresas.filter(e => e.cnpj).map(e => ({
      nome: e.nome || e.razao || 'Sem nome',
      cnpj: e.cnpj.replace(/\D/g, ''),
      regime: 'Simples Nacional',
      oneflow_hash: e.app_hash || null,
      oneflow_token: e.token || null,
      ativo: true,
    }))
    const { data, error } = await supabase.from('clientes')
      .upsert(registros, { onConflict: 'cnpj', ignoreDuplicates: true }).select()
    if (!error) await get().fetchClientes()
    return { data, error }
  },

  // ── Tarefas ───────────────────────────────────────────────────────────────────
  fetchTarefas: async () => {
    const { data, error } = await supabase.from('tarefas')
      .select('*, clientes(nome, cnpj)')
      .order('vencimento', { ascending: true, nullsFirst: false })
    if (!error) set({ tarefas: data || [] })
  },

  addTarefa: async (tarefa) => {
    const { data, error } = await supabase.from('tarefas')
      .insert(tarefa).select('*, clientes(nome, cnpj)').single()
    if (!error) set(s => ({ tarefas: [data, ...s.tarefas] }))
    return { data, error }
  },

  toggleTarefa: async (id) => {
    const tarefa = get().tarefas.find(t => t.id === id)
    if (!tarefa) return
    const concluida = !tarefa.concluida
    const { data, error } = await supabase.from('tarefas')
      .update({ concluida, concluida_em: concluida ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', id).select('*, clientes(nome, cnpj)').single()
    if (!error) set(s => ({ tarefas: s.tarefas.map(t => t.id === id ? data : t) }))
  },

  deleteTarefa: async (id) => {
    const { error } = await supabase.from('tarefas').delete().eq('id', id)
    if (!error) set(s => ({ tarefas: s.tarefas.filter(t => t.id !== id) }))
    return { error }
  },

  // ── Fechamentos ERP ───────────────────────────────────────────────────────────
  fetchFechamentos: async () => {
    const { data, error } = await supabase.from('fechamentos_erp')
      .select('*, clientes(nome)').order('sincronizado_em', { ascending: false })
    if (!error) set({ fechamentos: data || [] })
  },

  upsertFechamento: async (fechamento) => {
    const { data, error } = await supabase.from('fechamentos_erp')
      .upsert(fechamento, { onConflict: 'cliente_id,competencia,tipo' }).select().single()
    if (!error) {
      set(s => {
        const sem = s.fechamentos.filter(f =>
          !(f.cliente_id === fechamento.cliente_id && f.competencia === fechamento.competencia && f.tipo === fechamento.tipo))
        return { fechamentos: [data, ...sem] }
      })
    }
    return { data, error }
  },

  // ── Obrigações ────────────────────────────────────────────────────────────────
  fetchObrigacoes: async () => {
    const { data, error } = await supabase.from('obrigacoes')
      .select('*').order('competencia', { ascending: false })
    if (error) { console.error('fetchObrigacoes:', error); return }
    set({ obrigacoes: data || [] })
  },

  // FIX: upsert correto — usa id quando existe, insert quando não existe
  upsertObrigacao: async (obrigacao) => {
    const now = new Date().toISOString()
    let data, error

    if (obrigacao.id) {
      // UPDATE pelo id
      const res = await supabase.from('obrigacoes')
        .update({ ...obrigacao, updated_at: now })
        .eq('id', obrigacao.id)
        .select().single()
      data = res.data; error = res.error
    } else {
      // UPSERT pelo constraint único
      const res = await supabase.from('obrigacoes')
        .upsert({ ...obrigacao, updated_at: now }, { onConflict: 'cliente_id,tipo,competencia' })
        .select().single()
      data = res.data; error = res.error
    }

    if (error) { console.error('upsertObrigacao:', error); return { error } }

    // Atualiza estado local sem refetch completo
    set(s => {
      const sem = s.obrigacoes.filter(o => o.id !== data.id)
      return { obrigacoes: [data, ...sem] }
    })
    return { data }
  },

  gerarObrigacoesMes: async (competencia, clienteIds) => {
    const { clientes } = get()
    const alvos = clienteIds?.length ? clientes.filter(c => clienteIds.includes(c.id)) : clientes
    const TIPOS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e']
    const VENC  = { PGDAS: 20, DCTFWeb: 15, eSocial: 7, 'NFS-e': 10 }
    const [mes, ano] = competencia.split('/')

    const registros = []
    alvos.forEach(cliente => {
      TIPOS.forEach(tipo => {
        const d = new Date(parseInt(ano), parseInt(mes), VENC[tipo] || 20)
        registros.push({
          cliente_id: cliente.id, tipo, competencia, status: 'pendente',
          vencimento: d.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        })
      })
    })

    const { error } = await supabase.from('obrigacoes')
      .upsert(registros, { onConflict: 'cliente_id,tipo,competencia', ignoreDuplicates: true })
    if (error) throw error
    await get().fetchObrigacoes()
  },

  // ── OneFlow config ────────────────────────────────────────────────────────────
  setOneflowConfig: (cfg) => {
    set(s => ({ oneflowConfig: { ...s.oneflowConfig, ...cfg } }))
  },

  loadOneflowConfig: async () => {
    const { data, error } = await supabase.from('configuracoes').select('*').like('chave', 'of_%')
    if (error || !data?.length) return
    const cfg = {}
    data.forEach(r => {
      if (r.chave === 'of_user_token'       && r.valor) cfg.userToken       = r.valor
      if (r.chave === 'of_refresh_token'    && r.valor) cfg.refreshToken    = r.valor
      if (r.chave === 'of_escritorio_token' && r.valor) cfg.escritorioToken = r.valor
      if (r.chave === 'of_escritorio_hash'  && r.valor) cfg.escritorioHash  = r.valor
      if (r.chave === 'of_token_expires_at' && r.valor) cfg.tokenExpiresAt  = r.valor
    })
    cfg.configurado = !!(cfg.userToken)
    set(s => ({ oneflowConfig: { ...s.oneflowConfig, ...cfg } }))
  },

  // ── Init ──────────────────────────────────────────────────────────────────────
  init: async () => {
    const { fetchClientes, fetchTarefas, fetchFechamentos, loadOneflowConfig, fetchObrigacoes } = get()
    await Promise.all([fetchClientes(), fetchTarefas(), fetchFechamentos(), loadOneflowConfig(), fetchObrigacoes()])
  },
}))
