// Supabase em memória com o subconjunto do query builder usado pelo módulo de NFS-e.
// Imita também a função SQL nfse_reservar_numero.

function criarSupabaseFalso({ usuarios = {}, tabelas = {} } = {}) {
  const db = { nfse_empresas: [], nfse_certificados: [], nfse_lotes: [], nfse_notas: [], nfse_sequencias: [], nfse_eventos: [], nfse_tomadores: [], nfse_adn_notas: [], nfse_adn_controle: [], nfse_extrato_lancamentos: [], clientes: [], ...tabelas }
  let seq = 0
  const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const copia = (x) => JSON.parse(JSON.stringify(x))
  const chaves = { nfse_empresas: ['cliente_id'], nfse_certificados: ['cliente_id'] }

  function consulta(tabela) {
    const filtros = []
    let op = 'select'
    let dados = null
    let opcoes = {}
    let retornar = false
    let ordem = []
    const q = {
      select() { if (op !== 'select') retornar = true; return q },
      eq(c, v) { filtros.push((r) => r[c] === v); return q },
      neq(c, v) { filtros.push((r) => r[c] !== v); return q },
      in(c, vs) { filtros.push((r) => vs.includes(r[c])); return q },
      not(c, operador, v) { filtros.push((r) => (operador === 'is' && v === null ? r[c] != null : r[c] !== v)); return q },
      limit() { return q },
      order(c) { ordem.push(c); return q },
      insert(d) { op = 'insert'; dados = d; return q },
      update(d) { op = 'update'; dados = d; return q },
      upsert(d, o) { op = 'upsert'; dados = d; opcoes = o || {}; return q },
      delete() { op = 'delete'; return q },
      single() { q._unico = 'single'; return q },
      maybeSingle() { q._unico = 'maybe'; return q },
      then(ok, erro) { return Promise.resolve().then(executar).then(ok, erro) },
    }
    function executar() {
      const linhas = db[tabela]
      const casa = (r) => filtros.every((f) => f(r))
      let out
      if (op === 'select') out = linhas.filter(casa)
      else if (op === 'insert') {
        const novos = (Array.isArray(dados) ? dados : [dados]).map((d) => ({ id: uid(), criado_em: new Date().toISOString(), ...d }))
        if (tabela === 'nfse_notas') novos.forEach((n) => Object.assign(n, {
          estado: n.estado || 'importada', status_validacao: n.status_validacao || 'pendente', pendencias: n.pendencias || [],
          erros: n.erros || [], avisos: n.avisos || [], serie: n.serie || null, n_dps: n.n_dps || null, id_dps: null,
          chave_acesso: null, numero_nfse: null, mensagem_sefin: null, xml_enviado: null, xml_retorno: null, copiada_para: null,
        }))
        linhas.push(...novos)
        out = novos
      } else if (op === 'update') {
        out = linhas.filter(casa)
        out.forEach((r) => Object.assign(r, dados))
      } else if (op === 'upsert') {
        const k = (opcoes.onConflict || 'id').split(',')
        const existente = linhas.find((r) => k.every((c) => r[c] === dados[c]))
        if (existente) Object.assign(existente, dados)
        const novo = existente ? null : { id: uid(), criado_em: new Date().toISOString(), ...dados }
        if (novo) linhas.push(novo)
        out = [existente || novo]
      } else if (op === 'delete') {
        out = linhas.filter(casa)
        db[tabela] = linhas.filter((r) => !casa(r))
      }
      if (op !== 'select' && !retornar && !q._unico) return { data: null, error: null }
      out = out.map(copia)
      if (q._unico === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'não é uma linha' } }
      if (q._unico === 'maybe') return { data: out[0] || null, error: null }
      return { data: out, error: null }
    }
    void chaves
    return q
  }

  async function rpc(nome, args) {
    if (nome !== 'nfse_reservar_numero') return { data: null, error: { message: 'rpc desconhecida' } }
    const n = db.nfse_notas.find((x) => x.id === args.p_nota)
    if (!n) return { data: null, error: { message: 'Nota não encontrada' } }
    if (n.n_dps) return { data: n.n_dps, error: null }
    if (n.estado !== 'validada') return { data: null, error: { message: `Nota em estado ${n.estado}` } }
    const serie = db.nfse_empresas.find((e) => e.cliente_id === n.cliente_id).serie_dps
    let s = db.nfse_sequencias.find((x) => x.cliente_id === n.cliente_id && x.ambiente === n.ambiente && x.serie === serie)
    if (s) s.ultimo_numero += 1
    else { s = { cliente_id: n.cliente_id, ambiente: n.ambiente, serie, ultimo_numero: 1 }; db.nfse_sequencias.push(s) }
    Object.assign(n, { estado: 'numero_reservado', serie, n_dps: s.ultimo_numero })
    db.nfse_eventos.push({ nota_id: n.id, estado_de: 'validada', estado_para: 'numero_reservado', usuario: args.p_usuario })
    return { data: s.ultimo_numero, error: null }
  }

  return {
    db,
    from: consulta,
    rpc,
    auth: { getUser: async (t) => (usuarios[t] ? { data: { user: usuarios[t] }, error: null } : { data: null, error: { message: 'jwt' } }) },
  }
}

module.exports = { criarSupabaseFalso }
