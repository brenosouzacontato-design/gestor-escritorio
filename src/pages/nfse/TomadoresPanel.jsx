import { useEffect, useMemo, useState } from 'react'
import { UsersIcon, PlusIcon, UploadIcon, Trash2Icon, PencilIcon, SearchIcon } from 'lucide-react'
import { Modal, useToast } from '../../components/shared'
import { chamarNfse, listarTomadores, arquivoParaBase64 } from './nfseApi'

// Cadastro de clientes do prestador (tomadores das notas). Serve de base para o emissor: ao importar
// atendimentos sem CPF, o CPF vem daqui quando o nome bate sem dúvida (ou por um apelido cadastrado).

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const titulo = { fontSize: 14, fontWeight: 700, color: 'var(--text1)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }
const suave = { color: 'var(--text3)', fontSize: 12 }
const cpfFmt = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || '')
const brl = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const normalizar = (t) => (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const VAZIO = { nome: '', cpf: '', apelidos: '', endereco: '', cep: '', email: '', telefone: '', descricao_padrao: '', valor_padrao: '', observacao: '', ativo: true }

const COR_ACAO = { novo: 'var(--ok)', atualizar: 'var(--info)', conflito: 'var(--danger)', erro: 'var(--danger)' }
const ROTULO_ACAO = { novo: 'novo', atualizar: 'atualiza', conflito: 'conflito — fica de fora', erro: 'erro' }

export default function TomadoresPanel({ clienteId }) {
  const { show } = useToast()
  const [lista, setLista] = useState(null)
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState(null) // objeto do formulário
  const [plano, setPlano] = useState(null) // prévia da importação de planilha
  const [arquivo, setArquivo] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    try { setLista(await listarTomadores(clienteId)) } catch (e) { show(e.message); setLista([]) }
  }
  useEffect(() => { setLista(null); carregar() }, [clienteId])

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim())
    const soDig = busca.replace(/\D/g, '')
    return (lista || []).filter((t) => !termo || normalizar(`${t.nome} ${(t.apelidos || []).join(' ')}`).includes(termo)
      || (soDig.length >= 3 && (t.cpf || '').includes(soDig)))
  }, [lista, busca])

  async function salvar() {
    setOcupado(true)
    try {
      await chamarNfse('tomador_salvar', { cliente_id: clienteId, tomador: editando })
      show('Cliente salvo')
      setEditando(null)
      await carregar()
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  async function excluir(t) {
    if (!window.confirm(`Excluir ${t.nome} do cadastro? As notas já emitidas não mudam.`)) return
    try { await chamarNfse('tomador_excluir', { cliente_id: clienteId, id: t.id }); await carregar() } catch (e) { show(e.message) }
  }

  async function preverPlanilha(f) {
    if (!f) return
    setArquivo(f)
    setOcupado(true)
    try {
      const r = await chamarNfse('tomadores_importar', { cliente_id: clienteId, planilha_base64: await arquivoParaBase64(f) })
      setPlano(r.plano)
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  async function gravarPlanilha() {
    setOcupado(true)
    try {
      const r = await chamarNfse('tomadores_importar', { cliente_id: clienteId, planilha_base64: await arquivoParaBase64(arquivo), gravar: true })
      show(`${r.gravados} cliente(s) gravado(s)`)
      setPlano(r.plano.some((p) => ['conflito', 'erro'].includes(p.acao)) ? r.plano.filter((p) => ['conflito', 'erro'].includes(p.acao)) : null)
      await carregar()
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  const semCpf = (lista || []).filter((t) => !t.cpf).length

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={titulo}><UsersIcon size={16} /> Clientes do prestador</h3>
        <span style={suave}>
          {lista === null ? 'carregando…' : `${lista.length} cadastrado(s)${semCpf ? ` · ${semCpf} sem CPF` : ''}`}
        </span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAberto((a) => !a)}>{aberto ? 'Fechar' : 'Abrir'}</button>
      </div>

      {aberto && (
        <>
          <p style={{ ...suave, margin: '8px 0 12px' }}>
            Base para o emissor: ao importar atendimentos sem CPF, o CPF vem daqui quando o nome bate sem dúvida
            (ou por um apelido, como "José Ricardo" para a nota sair em nome de "Maria Helena Costa").
            Nome parecido não é preenchido sozinho: aparece como aviso para você confirmar.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text3)' }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, apelido ou CPF" style={{ paddingLeft: 30 }} />
            </div>
            <button className="btn btn-accent" onClick={() => setEditando({ ...VAZIO })}><PlusIcon size={14} /> Novo cliente</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              <UploadIcon size={14} /> Importar planilha
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={ocupado}
                onChange={(e) => { preverPlanilha(e.target.files[0]); e.target.value = '' }} />
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                  {['Nome', 'CPF', 'Apelidos', 'Descrição padrão', 'Valor padrão', ''].map((h) => (
                    <th key={h} style={{ padding: 6, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', opacity: t.ativo === false ? 0.5 : 1 }}>
                    <td style={{ padding: 6, fontWeight: 600 }}>{t.nome}</td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{t.cpf ? cpfFmt(t.cpf) : <span style={{ color: 'var(--warn)' }}>sem CPF</span>}</td>
                    <td style={{ padding: 6 }}>{(t.apelidos || []).join(', ')}</td>
                    <td style={{ padding: 6 }}>{t.descricao_padrao}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{brl(t.valor_padrao)}</td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-icon btn-ghost" title="Editar"
                        onClick={() => setEditando({ ...VAZIO, ...t, apelidos: (t.apelidos || []).join(', '), cpf: cpfFmt(t.cpf), valor_padrao: t.valor_padrao ?? '' })}>
                        <PencilIcon size={14} /></button>
                      <button className="btn btn-icon btn-ghost" title="Excluir" onClick={() => excluir(t)}><Trash2Icon size={14} /></button>
                    </td>
                  </tr>
                ))}
                {lista && !filtrados.length && (
                  <tr><td colSpan={6} style={{ ...suave, padding: 12 }}>{lista.length ? 'Nenhum cliente com esse filtro.' : 'Nenhum cliente cadastrado ainda. Importe a planilha de controle ou cadastre um a um.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editando && (
        <Modal onClose={() => setEditando(null)}>
          <div className="modal-title">{editando.id ? 'Editar cliente' : 'Novo cliente'}</div>
          <div className="form-field"><label className="form-label">Nome (como sai na nota)</label>
            <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} autoFocus /></div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">CPF</label>
              <input value={editando.cpf} onChange={(e) => setEditando({ ...editando, cpf: e.target.value })} placeholder="000.000.000-00" /></div>
            <div className="form-field"><label className="form-label">Valor padrão</label>
              <input value={editando.valor_padrao} onChange={(e) => setEditando({ ...editando, valor_padrao: e.target.value })} placeholder="ex.: 480,00" /></div>
          </div>
          <div className="form-field"><label className="form-label">Apelidos (separados por vírgula)</label>
            <input value={editando.apelidos} onChange={(e) => setEditando({ ...editando, apelidos: e.target.value })} placeholder="ex.: José Ricardo, Mãe do João" />
            <div style={suave}>Outros nomes pelos quais a pessoa aparece nas mensagens. A nota sai no nome acima.</div></div>
          <div className="form-field"><label className="form-label">Descrição padrão do serviço</label>
            <input value={editando.descricao_padrao} onChange={(e) => setEditando({ ...editando, descricao_padrao: e.target.value })} /></div>
          <div className="form-row">
            <div className="form-field" style={{ flex: 3 }}><label className="form-label">Endereço</label>
              <input value={editando.endereco} onChange={(e) => setEditando({ ...editando, endereco: e.target.value })} /></div>
            <div className="form-field"><label className="form-label">CEP</label>
              <input value={editando.cep} onChange={(e) => setEditando({ ...editando, cep: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">E-mail</label>
              <input value={editando.email} onChange={(e) => setEditando({ ...editando, email: e.target.value })} /></div>
            <div className="form-field"><label className="form-label">Telefone</label>
              <input value={editando.telefone} onChange={(e) => setEditando({ ...editando, telefone: e.target.value })} /></div>
          </div>
          <div className="form-field"><label className="form-label">Observação</label>
            <input value={editando.observacao} onChange={(e) => setEditando({ ...editando, observacao: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={editando.ativo !== false} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} />
            Ativo (inativo não é usado para preencher CPF)
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-accent" disabled={ocupado} onClick={salvar}>Salvar</button>
          </div>
        </Modal>
      )}

      {plano && (
        <Modal onClose={() => setPlano(null)}>
          <div className="modal-title">Importar clientes da planilha</div>
          <p style={suave}>
            {plano.filter((p) => p.acao === 'novo').length} novo(s), {plano.filter((p) => p.acao === 'atualizar').length} a atualizar,{' '}
            {plano.filter((p) => ['conflito', 'erro'].includes(p.acao)).length} com conflito (ficam de fora para você conferir).
          </p>
          <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {plano.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                    <td style={{ padding: 5, color: COR_ACAO[p.acao], fontWeight: 700, whiteSpace: 'nowrap' }}>{ROTULO_ACAO[p.acao]}</td>
                    <td style={{ padding: 5 }}>{p.nome}{p.apelidos?.length ? <span style={suave}> ({p.apelidos.join(', ')})</span> : null}</td>
                    <td style={{ padding: 5, whiteSpace: 'nowrap' }}>{cpfFmt(p.cpf) || '—'}</td>
                    <td style={{ padding: 5, ...suave }}>{(p.avisos || []).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setPlano(null)}>Fechar</button>
            {arquivo && plano.some((p) => ['novo', 'atualizar'].includes(p.acao)) && (
              <button className="btn btn-accent" disabled={ocupado} onClick={gravarPlanilha}>Gravar no cadastro</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
