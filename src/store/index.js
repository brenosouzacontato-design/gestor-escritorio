import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useStore = create((set, get) => ({
  // ── Estado ──────────────────────────────────────────────────────────────────
  clientes: [],
  tarefas: [],
  fechamentos: [],
  obrigacoes: [],
  prospectos: [],
  loading: false,
  syncingErp: false,
  oneflowConfig: {
    userToken: '',
    refreshToken: '',
    escritorioToken: '',
    escritorioHash: '',
    tokenExpiresAt: null,
    configurado: false,
  },

  // ── Clientes ─────────────────────────────────────────────────────────────────
  fetchClientes: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('ativo', true)
      .order('nome')
    if (error) console.error('fetchClientes error:', error)
    if (!error) set({ clientes: data || [] })
    set({ loading: false })
  },

  addCliente: async (cliente) => {
    const { data, error } = await supabase.from('clientes').insert(cliente).select().single()
    if (!error) set(s => ({ clientes: [...s.clientes, data] }))
    return { data, error }
  },

  updateCliente: async (id, updates) => {
    const { data, error } = await supabase
      .from('clientes').update({ ...updates, updated_at: new Date().toISOString() })
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
    const registros = empresas
      .filter(e => e.cnpj)
      .map(e => ({
        nome: e.nome || e.razao || 'Sem nome',
        cnpj: e.cnpj.replace(/\D/g, ''),
        regime: 'Simples Nacional',
        oneflow_hash: e.app_hash || null,
        oneflow_token: e.token || null,
        ativo: true,
      }))
    const { data, error } = await supabase
      .from('clientes')
      .upsert(registros, { onConflict: 'cnpj', ignoreDuplicates: true })
      .select()
    console.log('syncEmpresasOneFlow result:', data?.length, 'error:', JSON.stringify(error))
    if (!error) await get().fetchClientes()
    return { data, error }
  },

  // ── Tarefas ──────────────────────────────────────────────────────────────────
  fetchTarefas: async () => {
    const { data, error } = await supabase
      .from('tarefas')
      .select('*, clientes(nome, cnpj)')
      .order('vencimento', { ascending: true, nullsFirst: false })
    if (!error) set({ tarefas: data || [] })
  },

  addTarefa: async (tarefa) => {
    const { data, error } = await supabase.from('tarefas').insert(tarefa).select('*, clientes(nome, cnpj)').single()
    if (!error) set(s => ({ tarefas: [data, ...s.tarefas] }))
    return { data, error }
  },

  toggleTarefa: async (id) => {
    const tarefa = get().tarefas.find(t => t.id === id)
    if (!tarefa) return
    const concluida = !tarefa.concluida
    const { data, error } = await supabase
      .from('tarefas')
      .update({ concluida, concluida_em: concluida ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', id).select('*, clientes(nome, cnpj)').single()
    if (!error) set(s => ({ tarefas: s.tarefas.map(t => t.id === id ? data : t) }))
  },

  deleteTarefa: async (id) => {
    const { error } = await supabase.from('tarefas').delete().eq('id', id)
    if (!error) set(s => ({ tarefas: s.tarefas.filter(t => t.id !== id) }))
    return { error }
  },

  // ── Fechamentos ERP ──────────────────────────────────────────────────────────
  fetchFechamentos: async () => {
    const { data, error } = await supabase
      .from('fechamentos_erp')
      .select('*, clientes(nome)')
      .order('sincronizado_em', { ascending: false })
    if (!error) set({ fechamentos: data || [] })
  },

  upsertFechamento: async (fechamento) => {
    const { data, error } = await supabase
      .from('fechamentos_erp')
      .upsert(fechamento, { onConflict: 'cliente_id,competencia,tipo' })
      .select().single()
    if (!error) {
      set(s => {
        const sem = s.fechamentos.filter(
          f => !(f.cliente_id === fechamento.cliente_id && f.competencia === fechamento.competencia && f.tipo === fechamento.tipo)
        )
        return { fechamentos: [data, ...sem] }
      })
    }
    return { data, error }
  },

  // ── Obrigações ───────────────────────────────────────────────────────────────
  fetchObrigacoes: async () => {
    const { data, error } = await supabase
      .from('obrigacoes')
      .select('*, clientes(nome)')
      .order('competencia', { ascending: false })
    if (error) console.error('fetchObrigacoes error:', error)
    if (!error) set({ obrigacoes: data || [] })
  },

  upsertObrigacao: async (obrigacao) => {
    const { data, error } = await supabase
      .from('obrigacoes')
      .upsert({ ...obrigacao, updated_at: new Date().toISOString() }, { onConflict: 'cliente_id,tipo,competencia' })
      .select().single()
    if (error) console.error('upsertObrigacao error:', error)
    if (!error) {
      set(s => {
        const sem = s.obrigacoes.filter(o =>
          !(o.cliente_id === obrigacao.cliente_id && o.tipo === obrigacao.tipo && o.competencia === obrigacao.competencia)
        )
        return { obrigacoes: [data, ...sem] }
      })
    }
    return { data, error }
  },

  gerarObrigacoesMes: async (competencia) => {
    const { clientes } = get()
    const TIPOS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e']
    const VENCIMENTOS = { PGDAS: 20, DCTFWeb: 15, eSocial: 7, 'NFS-e': 10 }

    const [mes, ano] = competencia.split('/')
    const registros = []

    clientes.forEach(cliente => {
      TIPOS.forEach(tipo => {
        const dia = VENCIMENTOS[tipo] || 20
        const d = new Date(parseInt(ano), parseInt(mes), dia)
        registros.push({
          cliente_id: cliente.id,
          tipo,
          competencia,
          status: 'pendente',
          vencimento: d.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        })
      })
    })

    const { data, error } = await supabase
      .from('obrigacoes')
      .upsert(registros, { onConflict: 'cliente_id,tipo,competencia', ignoreDuplicates: true })
      .select()

    if (error) { console.error('gerarObrigacoesMes error:', error); throw error }
    await get().fetchObrigacoes()
    return { data }
  },

  // ── OneFlow config ───────────────────────────────────────────────────────────
  setOneflowConfig: (cfg) => {
    set(s => ({ oneflowConfig: { ...s.oneflowConfig, ...cfg } }))
    const { userToken, refreshToken, escritorioToken, escritorioHash, tokenExpiresAt } = { ...get().oneflowConfig, ...cfg }
    supabase.from('configuracoes').upsert([
      { chave: 'of_user_token', valor: userToken },
      { chave: 'of_refresh_token', valor: refreshToken },
      { chave: 'of_escritorio_token', valor: escritorioToken },
      { chave: 'of_escritorio_hash', valor: escritorioHash },
      { chave: 'of_token_expires_at', valor: tokenExpiresAt },
    ], { onConflict: 'chave' })
  },

  loadOneflowConfig: async () => {
    const { data } = await supabase.from('configuracoes').select('*').like('chave', 'of_%')
    if (data?.length) {
      const cfg = {}
      data.forEach(r => {
        if (r.chave === 'of_user_token') cfg.userToken = r.valor
        if (r.chave === 'of_refresh_token') cfg.refreshToken = r.valor
        if (r.chave === 'of_escritorio_token') cfg.escritorioToken = r.valor
        if (r.chave === 'of_escritorio_hash') cfg.escritorioHash = r.valor
        if (r.chave === 'of_token_expires_at') cfg.tokenExpiresAt = r.valor
      })
      cfg.configurado = !!(cfg.userToken)
      set(s => ({ oneflowConfig: { ...s.oneflowConfig, ...cfg } }))
    }
  },

  // ── Prospectos ───────────────────────────────────────────────────────────────
  fetchProspectos: async () => {
    const { data, error } = await supabase
      .from('prospectos')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) console.error('fetchProspectos error:', error)
    if (!error) set({ prospectos: data || [] })
  },

  addProspecto: async (prospecto) => {
    const { data, error } = await supabase.from('prospectos').insert(prospecto).select().single()
    if (!error) set(s => ({ prospectos: [data, ...s.prospectos] }))
    return { data, error }
  },

  updateProspecto: async (id, updates) => {
    const { data, error } = await supabase
      .from('prospectos')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (!error) set(s => ({ prospectos: s.prospectos.map(p => p.id === id ? data : p) }))
    return { data, error }
  },

  deleteProspecto: async (id) => {
    const { error } = await supabase.from('prospectos').delete().eq('id', id)
    if (!error) set(s => ({ prospectos: s.prospectos.filter(p => p.id !== id) }))
    return { error }
  },

  converterProspectoEmCliente: async (prospecto, dadosCliente) => {
    const { data: cliente, error: errCliente } = await supabase.from('clientes').insert({
      nome: dadosCliente.nome || prospecto.nome,
      cnpj: dadosCliente.cnpj || null,
      regime: dadosCliente.regime || 'Simples Nacional',
      ativo: true,
    }).select().single()
    if (errCliente) return { error: errCliente }
    await supabase.from('prospectos').update({ status: 'convertido', updated_at: new Date().toISOString() }).eq('id', prospecto.id)
    set(s => ({
      clientes: [...s.clientes, cliente],
      prospectos: s.prospectos.map(p => p.id === prospecto.id ? { ...p, status: 'convertido' } : p),
    }))
    return { data: cliente }
  },

  // ── Init ──────────────────────────────────────────────────────────────────────
  init: async () => {
    const { fetchClientes, fetchTarefas, fetchFechamentos, loadOneflowConfig, fetchObrigacoes, fetchProspectos } = get()
    await Promise.all([fetchClientes(), fetchTarefas(), fetchFechamentos(), loadOneflowConfig(), fetchObrigacoes(), fetchProspectos()])
  },
}))
