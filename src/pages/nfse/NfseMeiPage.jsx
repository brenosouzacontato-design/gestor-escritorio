import { useEffect, useRef, useState } from 'react'
import { BadgeCheckIcon, KeyRoundIcon, PlusIcon, PencilIcon, Trash2Icon, SendIcon, RefreshCwIcon, FileTextIcon, FileCodeIcon, XIcon, AlertTriangleIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/shared'

// NFS-e de MEI pelo Emissor Nacional (portal, login com CPF/CNPJ e senha), para quem não tem certificado A1.
// Cada empresa tem modelos (tomador, código do serviço, descrição, valor sugerido). "Emitir" põe a nota na fila;
// o robô do servidor (deploy/robo-parcelamentos/nfse_mei.py) emite no portal e manda PDF/XML no WhatsApp
// do cliente. Servidor: netlify/functions/nfse-mei.js. Ver docs/nfse-mei.md.

async function chamar(acao, dados = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session && data.session.access_token
  if (!token) throw new Error('Sessão expirada. Entre de novo no gestor.')
  const r = await fetch('/.netlify/functions/nfse-mei', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ acao, ...dados }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(corpo.erro || `Erro ${r.status}`), { status: r.status })
  return corpo
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const suave = { color: 'var(--text3)', fontSize: 12 }
const td = { padding: '6px 8px', borderTop: '1px solid var(--border)', verticalAlign: 'middle', fontSize: 12 }
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const soDig = (v) => String(v || '').replace(/\D/g, '')
const docFmt = (d) => {
  const s = soDig(d)
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || ''
}
const codFmt = (c) => (soDig(c).length === 6 ? soDig(c).replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : c || '')
const hoje = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
// mesmo que descricaoDoMes (netlify/functions/lib/nfse/mei.js): {mes} → "novembro de 2026"
const comMes = (desc, comp) => { const [a, m] = String(comp || '').split('-'); return a && m ? String(desc || '').replace(/\{mes\}/gi, `${MESES[Number(m) - 1]} de ${a}`) : desc }
const nomeCurto = (n) => String(n || '').replace(/^[\d.]+\s+/, '')

const STATUS = {
  na_fila: ['Na fila do robô', 'var(--text2)', 'var(--surface2)'],
  processando: ['Robô emitindo…', 'var(--accent)', 'var(--accent-dim)'],
  aguardando_pessoa: ['Conferir e clicar em Emitir (tela remota)', 'var(--warn)', 'var(--warn-dim)'],
  emitida: ['Emitida', 'var(--ok)', 'var(--ok-dim)'],
  erro: ['Erro', 'var(--danger)', 'var(--danger-dim)'],
  cancelada: ['Cancelada', 'var(--text3)', 'var(--surface2)'],
}
const EM_ANDAMENTO = ['na_fila', 'processando', 'aguardando_pessoa']
const VAZIO = { tomador_nome: '', tomador_doc: '', codigo_tributacao: '', municipio_prestacao: '', descricao: '', valor: '' }

export default function NfseMeiPage() {
  const { show } = useToast()
  const [empresas, setEmpresas] = useState(null)
  const [clienteId, setClienteId] = useState('')
  const [dados, setDados] = useState(null)

  async function carregarEmpresas() {
    try { setEmpresas((await chamar('empresas')).empresas) } catch (e) { show(e.message); setEmpresas([]) }
  }
  async function carregar(id = clienteId) {
    if (!id) return
    try { setDados({ ...(await chamar('carregar', { cliente_id: id })), clienteId: id }) } catch (e) { show(e.message) }
  }
  useEffect(() => { carregarEmpresas() }, [])
  useEffect(() => { setDados(null); carregar(clienteId) }, [clienteId])

  // enquanto o robô trabalha, atualiza sozinho
  const andando = (dados?.notas || []).some((n) => EM_ANDAMENTO.includes(n.status))
  const timer = useRef(null)
  useEffect(() => {
    clearInterval(timer.current)
    if (andando) timer.current = setInterval(() => carregar(), 8000)
    return () => clearInterval(timer.current)
  }, [andando, clienteId])

  const atual = (empresas || []).find((e) => e.id === clienteId)
  const semSenha = (empresas || []).filter((e) => !e.tem_senha).length

  async function importarSenhas() {
    try {
      const r = await chamar('importar_senhas')
      show(`${r.copiadas.length} senha(s) copiada(s) das observações` + (r.sem.length ? `; sem senha nas observações: ${r.sem.length}` : ''))
      await carregarEmpresas()
      if (clienteId) await carregar()
    } catch (e) { show(e.message) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <BadgeCheckIcon size={18} /> NFS-e MEI (Emissor Nacional)
      </h2>
      <p style={{ ...suave, marginBottom: 14 }}>
        Para MEI sem certificado: o robô entra no portal nacional com a senha da empresa, emite a nota do modelo e manda o PDF e o XML
        no WhatsApp do cliente assim que sair autorizada.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ ...card, padding: 8 }}>
          {semSenha > 0 && (
            <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, marginBottom: 6 }} onClick={importarSenhas}
              title='Lê a linha "... nfse: SENHA" das observações do cadastro e guarda cifrada'>
              <KeyRoundIcon size={13} /> Pegar senhas das observações ({semSenha} sem senha)
            </button>
          )}
          {empresas === null && <div style={{ ...suave, padding: 8 }}>Carregando…</div>}
          {empresas?.length === 0 && <div style={{ ...suave, padding: 8 }}>Nenhum cliente MEI ativo.</div>}
          {(empresas || []).map((e) => (
            <button key={e.id} onClick={() => setClienteId(e.id)} className="btn btn-ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                background: e.id === clienteId ? 'var(--accent-dim)' : 'transparent' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{nomeCurto(e.nome)}</div>
              <div style={{ ...suave, fontSize: 11, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: e.tem_senha ? 'var(--ok)' : 'var(--text3)' }}>{e.tem_senha ? 'senha ok' : 'sem senha'}</span>·
                <span>{e.modelos} modelo(s)</span>·
                <span style={{ color: e.whatsapp ? 'var(--text3)' : 'var(--danger)' }}>{e.whatsapp ? 'WhatsApp ok' : 'sem WhatsApp'}</span>
              </div>
            </button>
          ))}
        </div>

        <div>
          {!clienteId && <div style={{ ...card, ...suave }}>Escolha uma empresa.</div>}
          {clienteId && !dados && <div style={{ ...card, ...suave }}>Carregando…</div>}
          {dados && dados.clienteId === clienteId && (
            <>
              <Senha clienteId={clienteId} dados={dados} onSalva={() => { carregar(); carregarEmpresas() }} />
              {!dados.whatsapp && (
                <div style={{ ...card, background: 'var(--warn-dim)', color: 'var(--warn)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <AlertTriangleIcon size={14} /> Empresa sem WhatsApp no cadastro (WhatsApp de entrega ou telefone): a nota sai, mas não vai ao cliente.
                </div>
              )}
              <Modelos clienteId={clienteId} dados={dados} temSenha={dados.tem_senha} onMudou={() => { carregar(); carregarEmpresas() }} />
              <Notas clienteId={clienteId} notas={dados.notas} onMudou={() => carregar()} />
            </>
          )}
          {atual && !atual.tem_senha && dados && <div style={suave}>Cadastre a senha para poder emitir.</div>}
        </div>
      </div>
    </div>
  )
}

function Senha({ clienteId, dados, onSalva }) {
  const { show } = useToast()
  const [editando, setEditando] = useState(false)
  const [senha, setSenha] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function salvar() {
    setOcupado(true)
    try {
      await chamar('salvar_senha', { cliente_id: clienteId, senha })
      setSenha(''); setEditando(false); show('Senha salva (cifrada)'); onSalva()
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <KeyRoundIcon size={16} />
      <b style={{ fontSize: 13 }}>Senha do Emissor Nacional</b>
      {dados.tem_senha
        ? <span style={{ ...suave, color: 'var(--ok)' }}>cadastrada em {dataBR(dados.senha_em)}</span>
        : <span style={{ ...suave, color: 'var(--danger)' }}>não cadastrada</span>}
      {!editando
        ? <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setEditando(true)}>{dados.tem_senha ? 'Trocar' : 'Cadastrar'}</button>
        : (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha do portal" style={{ width: 200 }} />
            <button className="btn btn-accent" disabled={ocupado || !senha} onClick={salvar}>Salvar</button>
            <button className="btn btn-ghost" onClick={() => { setEditando(false); setSenha('') }}>Cancelar</button>
          </span>
        )}
      <div style={{ ...suave, width: '100%' }}>
        Guardada cifrada; só o robô lê. Depois de cadastrar aqui, apague a senha das observações do cadastro da empresa.
      </div>
    </div>
  )
}

function Modelos({ clienteId, dados, temSenha, onMudou }) {
  const { show } = useToast()
  const [form, setForm] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  async function salvar() {
    setOcupado(true)
    try {
      await chamar('salvar_modelo', { cliente_id: clienteId, modelo: form })
      setForm(null); show('Modelo salvo'); onMudou()
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }
  async function excluir(m) {
    if (!window.confirm(`Excluir o modelo "${m.tomador_nome || m.descricao.slice(0, 40)}"? As notas já emitidas continuam.`)) return
    try { await chamar('excluir_modelo', { cliente_id: clienteId, id: m.id }); onMudou() } catch (e) { show(e.message) }
  }
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 14 }}>Modelos de nota</b>
        {!form && <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setForm({ ...VAZIO })}><PlusIcon size={14} /> Novo modelo</button>}
      </div>
      <p style={{ ...suave, margin: '6px 0 10px' }}>O que se repete em toda nota: tomador, serviço e descrição. Na hora de emitir só confere o valor e a data.</p>
      {form && <FormModelo form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setForm(null)} ocupado={ocupado} />}
      {dados.modelos.length === 0 && !form && <div style={suave}>Nenhum modelo ainda.</div>}
      {dados.modelos.map((m) => (
        <Modelo key={m.id} m={m} clienteId={clienteId} temSenha={temSenha} onMudou={onMudou}
          onEditar={() => setForm({ ...m, tomador_doc: m.tomador_doc || '', valor: valorBR(m.valor), codigo_tributacao: codFmt(m.codigo_tributacao) })}
          onExcluir={() => excluir(m)} />
      ))}
    </div>
  )
}

function FormModelo({ form, setForm, onSalvar, onCancelar, ocupado }) {
  const campo = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }) })
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'var(--surface2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div><label className="form-label">Tomador (nome / razão social)</label><input {...campo('tomador_nome')} placeholder="Vazio = não identificado" /></div>
        <div><label className="form-label">CPF ou CNPJ do tomador</label><input value={docFmt(form.tomador_doc)} onChange={(e) => setForm({ ...form, tomador_doc: soDig(e.target.value).slice(0, 14) })} placeholder="opcional" /></div>
        <div><label className="form-label">Código de tributação nacional</label><input {...campo('codigo_tributacao')} placeholder="Ex.: 01.07.01" /></div>
        <div><label className="form-label">Município da prestação</label><input {...campo('municipio_prestacao')} placeholder="Vazio = o do MEI" /></div>
        <div><label className="form-label">Valor sugerido</label><input {...campo('valor')} placeholder="0,00" /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="form-label">Descrição do serviço — {'{mes}'} vira o mês da competência (ex.: novembro de 2026)</label>
        <textarea rows={2} {...campo('descricao')} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-accent" disabled={ocupado || !form.descricao.trim() || soDig(form.codigo_tributacao).length !== 6} onClick={onSalvar}>Salvar modelo</button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
        <span style={suave}>O código aparece no portal em "Serviço" (ou numa nota antiga do MEI).</span>
      </div>
    </div>
  )
}

function Modelo({ m, clienteId, temSenha, onEditar, onExcluir, onMudou }) {
  const { show } = useToast()
  const [nota, setNota] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  function abrir() { setNota({ valor: valorBR(m.valor), competencia: hoje(), descricao: m.descricao }) }
  async function emitir(confirmar = false) {
    setOcupado(true)
    try {
      const r = await chamar('emitir', {
        cliente_id: clienteId, modelo_id: m.id, confirmar_repetida: confirmar,
        nota: { ...m, id: undefined, ...nota },
      })
      if (r.repetida) {
        const rep = r.repetida
        if (window.confirm(`Já existe nota ${rep.numero ? `nº ${rep.numero} ` : ''}para este tomador com o mesmo valor em ${dataBR(rep.competencia).slice(3)}. Emitir mesmo assim?`)) {
          setOcupado(false)
          return emitir(true)
        }
        return
      }
      setNota(null); show('Nota na fila do robô'); onMudou()
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{m.tomador_nome || 'Tomador não identificado'}</b>
        <span style={suave}>{docFmt(m.tomador_doc)} · serviço {codFmt(m.codigo_tributacao)}{m.valor ? ` · ${brl(m.valor)}` : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {!nota && <button className="btn btn-accent btn-sm" disabled={!temSenha} title={temSenha ? '' : 'Cadastre a senha primeiro'} onClick={abrir}><SendIcon size={13} /> Emitir</button>}
          <button className="btn btn-icon btn-ghost" title="Editar modelo" onClick={onEditar}><PencilIcon size={13} /></button>
          <button className="btn btn-icon btn-ghost" title="Excluir modelo" onClick={onExcluir}><Trash2Icon size={13} /></button>
        </span>
      </div>
      <div style={{ ...suave, marginTop: 4 }}>{m.descricao}{m.municipio_prestacao ? ` · prestado em ${m.municipio_prestacao}` : ''}</div>
      {nota && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'var(--surface2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr', gap: 10 }}>
            <div><label className="form-label">Valor</label><input autoFocus value={nota.valor} onChange={(e) => setNota({ ...nota, valor: e.target.value })} placeholder="0,00" /></div>
            <div><label className="form-label">Competência</label><input type="date" max={hoje()} value={nota.competencia} onChange={(e) => setNota({ ...nota, competencia: e.target.value })} /></div>
            <div><label className="form-label">Descrição (só desta nota)</label><input value={nota.descricao} onChange={(e) => setNota({ ...nota, descricao: e.target.value })} /></div>
          </div>
          {/\{mes\}/i.test(nota.descricao) && <div style={{ ...suave, marginTop: 6 }}>Vai sair: {comMes(nota.descricao, nota.competencia)}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-accent" disabled={ocupado || !nota.valor} onClick={() => emitir()}>Emitir {nota.valor ? `R$ ${nota.valor}` : ''}</button>
            <button className="btn btn-ghost" onClick={() => setNota(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Notas({ clienteId, notas, onMudou }) {
  const { show } = useToast()
  async function acao(nome, n, extra = {}, msg) {
    try { await chamar(nome, { cliente_id: clienteId, id: n.id, ...extra }); if (msg) show(msg); onMudou() } catch (e) {
      if (e.status === 409 && nome === 'tentar_de_novo'
        && window.confirm(`${e.message}\n\nJá conferiu no portal e a nota NÃO saiu?`)) return acao(nome, n, { conferi_no_portal: true }, msg)
      show(e.message)
    }
  }
  async function abrirArquivo(n, tipo) {
    try { window.open((await chamar('arquivo', { cliente_id: clienteId, id: n.id, tipo })).url, '_blank') } catch (e) { show(e.message) }
  }
  return (
    <div style={card}>
      <b style={{ fontSize: 14 }}>Notas</b>
      {notas.length === 0 && <div style={{ ...suave, marginTop: 6 }}>Nenhuma nota pedida ainda.</div>}
      {notas.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <tbody>
            {notas.map((n) => {
              const [rot, cor, fundo] = STATUS[n.status] || [n.status, 'var(--text2)', 'var(--surface2)']
              return (
                <tr key={n.id}>
                  <td style={td}>{dataBR(n.competencia)}</td>
                  <td style={td}>
                    <div>{n.tomador_nome || 'Tomador não identificado'}</div>
                    {n.robo_mensagem && <div style={{ ...suave, fontSize: 11, color: n.status === 'erro' ? 'var(--danger)' : 'var(--text3)' }}>{n.robo_mensagem}</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{brl(n.valor)}</td>
                  <td style={td}>
                    <span style={{ background: fundo, color: cor, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {n.status === 'emitida' && n.numero ? `NFS-e nº ${n.numero}` : rot}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {n.pdf_path && <button className="btn btn-icon btn-ghost" title="PDF (DANFSe)" onClick={() => abrirArquivo(n, 'pdf')}><FileTextIcon size={14} /></button>}
                    {n.xml_path && <button className="btn btn-icon btn-ghost" title="XML" onClick={() => abrirArquivo(n, 'xml')}><FileCodeIcon size={14} /></button>}
                    {n.status === 'emitida' && <button className="btn btn-icon btn-ghost" title={n.whatsapp_enviado_em ? 'Mandar de novo no WhatsApp' : 'Mandar no WhatsApp'} onClick={() => acao('reenviar_whatsapp', n, {}, 'Enviada no WhatsApp')}><SendIcon size={14} /></button>}
                    {n.status === 'erro' && <button className="btn btn-icon btn-ghost" title="Mandar para o robô de novo" onClick={() => acao('tentar_de_novo', n, {}, 'De volta na fila')}><RefreshCwIcon size={14} /></button>}
                    {['na_fila', 'erro'].includes(n.status) && !n.talvez_emitida && <button className="btn btn-icon btn-ghost" title="Cancelar pedido" onClick={() => acao('cancelar', n)}><XIcon size={14} /></button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
