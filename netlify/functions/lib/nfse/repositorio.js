// netlify/functions/lib/nfse/repositorio.js
//
// Acesso às tabelas nfse_* (supabase-schema-nfse.sql). Duas implementações com a mesma interface:
//   - RepositorioSupabase: produção (service role, pelas Netlify Functions)
//   - RepositorioMemoria:  testes
//
// Mudança de estado é sempre condicional ("compare-and-set"): só muda se a nota ainda estiver no
// estado esperado. Sem transação no cliente JS do Supabase, é isso que impede dois cliques
// simultâneos de enviarem a mesma nota duas vezes. A reserva de número é uma função SQL atômica.

// importada → validada → numero_reservado → enviada → autorizada | rejeitada | indeterminada
// autorizada → cancelada: registro do cancelamento feito no portal nacional (não envia nada)
const TRANSICOES = {
  importada: ['validada'],
  validada: ['importada', 'numero_reservado'],
  numero_reservado: ['enviada'],
  enviada: ['autorizada', 'rejeitada', 'indeterminada'],
  indeterminada: ['autorizada', 'rejeitada', 'enviada'],
  rejeitada: [],
  autorizada: ['cancelada'],
  cancelada: [],
}
const EDITAVEIS = ['importada', 'validada'] // depois de reservar número, a nota não muda mais
const EM_EMISSAO_OU_EMITIDA = ['numero_reservado', 'enviada', 'autorizada', 'indeterminada']

class TransicaoInvalida extends Error {}

const CAMPOS_DUPLICIDADE = 'id, lote_id, estado, nome, cpf, data, valor, competencia, numero_nfse, chave_acesso, atualizado_em'

function conferirTransicao(de, para) {
  if (!(TRANSICOES[de] || []).includes(para)) throw new TransicaoInvalida(`${de} → ${para}`)
}

const agora = () => new Date().toISOString()

class RepositorioSupabase {
  constructor(supabase) {
    this.db = supabase
  }

  async _q(promessa) {
    const { data, error } = await promessa
    if (error) throw new Error(`Banco: ${error.message}`)
    return data
  }

  obterEmpresa(clienteId) {
    return this._q(this.db.from('nfse_empresas').select('*').eq('cliente_id', clienteId).maybeSingle())
  }

  obterNota(id) {
    return this._q(this.db.from('nfse_notas').select('*').eq('id', id).maybeSingle())
  }

  obterLote(id) {
    return this._q(this.db.from('nfse_lotes').select('*').eq('id', id).maybeSingle())
  }

  listarNotasLote(loteId) {
    return this._q(this.db.from('nfse_notas').select('*').eq('lote_id', loteId).order('criado_em').order('id'))
  }

  // Notas da mesma empresa e ambiente em outros lotes (para checar duplicidade)
  listarOutrasNotas(clienteId, ambiente, loteId) {
    return this._q(this.db.from('nfse_notas').select(CAMPOS_DUPLICIDADE)
      .eq('cliente_id', clienteId).eq('ambiente', ambiente).neq('lote_id', loteId))
  }

  // Todas as notas do prestador para um CPF (trava de duplicidade na hora de emitir)
  listarNotasDoTomador(clienteId, ambiente, cpf) {
    return this._q(this.db.from('nfse_notas').select(CAMPOS_DUPLICIDADE)
      .eq('cliente_id', clienteId).eq('ambiente', ambiente).eq('cpf', cpf))
  }

  // NFS-e autorizadas da empresa no Ambiente Nacional (nfse_adn_notas, inclusive as emitidas fora
  // do gestor). Sem a tabela (SQL ainda não aplicado), volta vazio: a validação segue como antes.
  async listarNotasNacionais(clienteId) {
    const { data, error } = await this.db.from('nfse_adn_notas')
      .select('chave_acesso, numero_nfse, tomador_doc, valor, emitida_em, competencia')
      .eq('cliente_id', clienteId).eq('ambiente', 'producao').eq('situacao', 'autorizada')
    if (error) { console.warn('nfse: notas do Ambiente Nacional indisponíveis:', error.message); return [] }
    return data || []
  }

  async inserirLote(lote) {
    return (await this._q(this.db.from('nfse_lotes').insert(lote).select('id').single())).id
  }

  inserirNotas(notas) {
    return notas.length ? this._q(this.db.from('nfse_notas').insert(notas).select('id')) : []
  }

  atualizarNota(id, campos) {
    return this._q(this.db.from('nfse_notas').update({ ...campos, atualizado_em: agora() }).eq('id', id))
  }

  excluirNota(id) {
    return this._q(this.db.from('nfse_notas').delete().eq('id', id).in('estado', EDITAVEIS))
  }

  registrarEvento(notaId, de, para, detalhe, usuario) {
    return this._q(this.db.from('nfse_eventos').insert({ nota_id: notaId, estado_de: de, estado_para: para, detalhe, usuario }))
  }

  async mudarEstado(id, de, para, detalhe = '', campos = {}, usuario = null) {
    conferirTransicao(de, para)
    const linhas = await this._q(this.db.from('nfse_notas')
      .update({ ...campos, estado: para, atualizado_em: agora() }).eq('id', id).eq('estado', de).select('id'))
    if (!linhas.length) throw new TransicaoInvalida(`A nota não está mais em '${de}' (outra emissão em andamento?)`)
    await this.registrarEvento(id, de, para, detalhe, usuario)
  }

  async reservarNumero(id, usuario = null) {
    return Number(await this._q(this.db.rpc('nfse_reservar_numero', { p_nota: id, p_usuario: usuario })))
  }

  async proximoNumero(clienteId, ambiente, serie) {
    const r = await this._q(this.db.from('nfse_sequencias').select('ultimo_numero')
      .eq('cliente_id', clienteId).eq('ambiente', ambiente).eq('serie', serie).maybeSingle())
    return (r ? Number(r.ultimo_numero) : 0) + 1
  }

  // Lotes da empresa com notas ainda editáveis (para revalidar quando a configuração muda)
  async listarLotesEmAberto(clienteId, ambiente) {
    const linhas = await this._q(this.db.from('nfse_notas').select('lote_id')
      .eq('cliente_id', clienteId).eq('ambiente', ambiente).in('estado', EDITAVEIS))
    return [...new Set(linhas.map((l) => l.lote_id))]
  }

  // Cadastro de clientes do prestador (nfse_tomadores)
  listarTomadores(clienteId) {
    return this._q(this.db.from('nfse_tomadores').select('*').eq('cliente_id', clienteId).order('nome'))
  }

  async salvarTomador(t) {
    const { id, ...campos } = t
    const dados = { ...campos, atualizado_em: agora() }
    if (id) return this._q(this.db.from('nfse_tomadores').update(dados).eq('id', id).eq('cliente_id', t.cliente_id).select('*').single())
    return this._q(this.db.from('nfse_tomadores').insert(dados).select('*').single())
  }

  excluirTomador(id, clienteId) {
    return this._q(this.db.from('nfse_tomadores').delete().eq('id', id).eq('cliente_id', clienteId))
  }
}

// Mesma interface, em memória (testes)
class RepositorioMemoria {
  constructor({ empresas = [] } = {}) {
    this.empresas = empresas
    this.lotes = []
    this.notas = []
    this.eventos = []
    this.sequencias = {}
    this._id = 0
  }

  _novoId() { return `id-${++this._id}` }
  _copia(x) { return x ? JSON.parse(JSON.stringify(x)) : null }

  async obterEmpresa(clienteId) { return this._copia(this.empresas.find((e) => e.cliente_id === clienteId)) }
  async obterNota(id) { return this._copia(this.notas.find((n) => n.id === id)) }
  async obterLote(id) { return this._copia(this.lotes.find((l) => l.id === id)) }
  async listarNotasLote(loteId) { return this.notas.filter((n) => n.lote_id === loteId).map((n) => this._copia(n)) }
  async listarOutrasNotas(clienteId, ambiente, loteId) {
    return this.notas.filter((n) => n.cliente_id === clienteId && n.ambiente === ambiente && n.lote_id !== loteId).map((n) => this._copia(n))
  }

  async listarNotasDoTomador(clienteId, ambiente, cpf) {
    return this.notas.filter((n) => n.cliente_id === clienteId && n.ambiente === ambiente && n.cpf === cpf).map((n) => this._copia(n))
  }

  async listarNotasNacionais(clienteId) {
    return (this.nacionais || []).filter((n) => n.cliente_id === clienteId).map((n) => this._copia(n))
  }

  async inserirLote(lote) {
    const id = this._novoId()
    this.lotes.push({ id, criado_em: agora(), ...lote })
    return id
  }

  async inserirNotas(notas) {
    return notas.map((n) => {
      const id = this._novoId()
      this.notas.push({
        id, estado: 'importada', status_validacao: 'pendente', pendencias: [], erros: [], avisos: [],
        competencia: null, serie: null, n_dps: null, id_dps: null, chave_acesso: null, numero_nfse: null,
        mensagem_sefin: null, xml_enviado: null, xml_retorno: null, copiada_para: null, recorrente_id: null,
        criado_em: agora(), atualizado_em: agora(), ...n,
      })
      return { id }
    })
  }

  async atualizarNota(id, campos) { Object.assign(this.notas.find((n) => n.id === id), campos, { atualizado_em: agora() }) }

  async excluirNota(id) {
    const i = this.notas.findIndex((n) => n.id === id && EDITAVEIS.includes(n.estado))
    if (i >= 0) this.notas.splice(i, 1)
  }

  async registrarEvento(notaId, de, para, detalhe, usuario) {
    this.eventos.push({ nota_id: notaId, estado_de: de, estado_para: para, detalhe, usuario })
  }

  async mudarEstado(id, de, para, detalhe = '', campos = {}, usuario = null) {
    conferirTransicao(de, para)
    const n = this.notas.find((x) => x.id === id)
    if (!n || n.estado !== de) throw new TransicaoInvalida(`A nota não está mais em '${de}' (outra emissão em andamento?)`)
    Object.assign(n, campos, { estado: para, atualizado_em: agora() })
    await this.registrarEvento(id, de, para, detalhe, usuario)
  }

  async reservarNumero(id, usuario = null) {
    const n = this.notas.find((x) => x.id === id)
    if (!n) throw new Error(`Nota ${id} não encontrada`)
    if (n.n_dps) return n.n_dps
    if (n.estado !== 'validada') throw new Error(`Nota em estado ${n.estado} não pode reservar número (precisa estar validada)`)
    const serie = this.empresas.find((e) => e.cliente_id === n.cliente_id).serie_dps
    const k = `${n.cliente_id}|${n.ambiente}|${serie}`
    this.sequencias[k] = (this.sequencias[k] || 0) + 1
    Object.assign(n, { estado: 'numero_reservado', serie, n_dps: this.sequencias[k] })
    await this.registrarEvento(id, 'validada', 'numero_reservado', `série ${serie} nº ${n.n_dps}`, usuario)
    return n.n_dps
  }

  async proximoNumero(clienteId, ambiente, serie) { return (this.sequencias[`${clienteId}|${ambiente}|${serie}`] || 0) + 1 }

  async listarLotesEmAberto(clienteId, ambiente) {
    return [...new Set(this.notas.filter((n) => n.cliente_id === clienteId && n.ambiente === ambiente && EDITAVEIS.includes(n.estado))
      .map((n) => n.lote_id))]
  }

  async listarTomadores(clienteId) {
    return (this.tomadores || []).filter((t) => t.cliente_id === clienteId).map((t) => this._copia(t))
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }

  async salvarTomador(t) {
    this.tomadores = this.tomadores || []
    if (t.cpf && this.tomadores.some((x) => x.cliente_id === t.cliente_id && x.cpf === t.cpf && x.id !== t.id)) {
      throw new Error('Banco: duplicate key value violates unique constraint "nfse_tomadores_cpf_idx"')
    }
    if (t.id) {
      const atual = this.tomadores.find((x) => x.id === t.id && x.cliente_id === t.cliente_id)
      if (!atual) throw new Error('Cliente não encontrado')
      Object.assign(atual, t, { atualizado_em: agora() })
      return this._copia(atual)
    }
    const novo = { id: this._novoId(), apelidos: [], endereco: '', cep: '', email: '', telefone: '', descricao_padrao: '',
      valor_padrao: null, observacao: '', ativo: true, ...t, criado_em: agora(), atualizado_em: agora() }
    this.tomadores.push(novo)
    return this._copia(novo)
  }

  async excluirTomador(id, clienteId) {
    this.tomadores = (this.tomadores || []).filter((t) => !(t.id === id && t.cliente_id === clienteId))
  }
}

module.exports = { RepositorioSupabase, RepositorioMemoria, TransicaoInvalida, TRANSICOES, EDITAVEIS, EM_EMISSAO_OU_EMITIDA }
