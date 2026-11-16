// Aba da empresa → Documentos: o que vai para o painel do cliente, à vista.
// Os mesmos envios do card da empresa no Fechamento (Empresas.jsx) — Declaração do
// Simples, Situação Fiscal / CND e CND marcada à mão — e os documentos diversos do
// painel (contrato, alvará, recibos...), que antes só apareciam no modo edição
// do painel, lá embaixo (PainelCompartilhadoPage → SecaoDocumentos).
import { useEffect, useRef, useState } from 'react'
import { BarChart3Icon, FileTextIcon, ShieldCheckIcon, PaperclipIcon, FolderOpenIcon, DownloadIcon, XIcon, PinIcon, CalendarIcon } from 'lucide-react'
import { useToast } from '../../components/shared'
import {
  uploadDeclaracaoSimples, uploadSituacaoFiscal, obterDocumentosPainel, anexarDocumentoPainel, definirDocumentoPainel,
} from '../painel/painelApi'
import { abrirLinkAssinado } from '../documentos/documentosApi'
import { resumoFiscal, ModalCndManual } from '../Empresas'

const nomeDoc = (d) => d.painel_titulo || d.tipo_documento_sugerido || d.nome_arquivo
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

const botaoEnvio = (ocupado) => ({
  flex: '1 1 180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 10px',
  border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text1)',
  fontSize: 12.5, fontWeight: 600, cursor: ocupado ? 'default' : 'pointer', opacity: ocupado ? 0.6 : 1,
})

export default function PainelUploadsEmpresa({ cliente, competencia }) {
  const { show } = useToast()
  const [enviando, setEnviando] = useState(null) // 'declaracao' | 'fiscal' | null
  const [cndManual, setCndManual] = useState(false)
  const [docs, setDocs] = useState(undefined) // undefined = carregando; null = falta o SQL do painel
  const [form, setForm] = useState(null) // { arquivo, titulo, fixo }
  const [salvando, setSalvando] = useState(false)
  const inputDoc = useRef(null)

  useEffect(() => {
    let ativo = true
    setDocs(undefined)
    obterDocumentosPainel(cliente.id, competencia).then((l) => ativo && setDocs(l)).catch(() => ativo && setDocs(null))
    return () => { ativo = false }
  }, [cliente.id, competencia])

  const enviarDeclaracao = async (arquivo) => {
    if (!arquivo) return
    setEnviando('declaracao')
    try {
      const s = await uploadDeclaracaoSimples(arquivo, competencia, { clienteId: cliente.id })
      show?.(`Declaração processada — competência ${s.competencia}${s.faturamento_periodo ? `, faturamento R$ ${Number(s.faturamento_periodo).toLocaleString('pt-BR')}` : ''}`)
    } catch (e) { show?.('Erro ao processar declaração: ' + e.message) }
    setEnviando(null)
  }

  const enviarFiscal = async (arquivos) => {
    const lista = Array.from(arquivos || [])
    if (!lista.length) return
    setEnviando('fiscal')
    const resumos = []
    for (const arquivo of lista) {
      try { resumos.push(resumoFiscal(await uploadSituacaoFiscal(arquivo, competencia, { clienteId: cliente.id }))) } catch (e) { resumos.push(`${arquivo.name}: erro — ${e.message}`) }
    }
    show?.(resumos.join(' · '))
    setEnviando(null)
  }

  const escolherDoc = (e) => {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (arquivo) setForm({ arquivo, titulo: arquivo.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(), fixo: false })
  }
  const salvarDoc = async () => {
    setSalvando(true)
    try {
      const novo = await anexarDocumentoPainel(cliente.id, form.arquivo, { titulo: form.titulo.trim(), competencia: form.fixo ? null : competencia })
      setDocs((l) => [novo, ...(l || [])])
      setForm(null)
      show?.('Documento anexado ao painel do cliente')
    } catch (e) { show?.('Não foi possível anexar: ' + e.message) }
    setSalvando(false)
  }
  const tirarDoPainel = async (d) => {
    if (!window.confirm(`Tirar "${nomeDoc(d)}" do painel? (o arquivo continua em Documentos)`)) return
    try {
      await definirDocumentoPainel(d.id, { painel_visivel: false })
      setDocs((l) => l.filter((x) => x.id !== d.id))
    } catch (e) { show?.('Não foi possível tirar: ' + e.message) }
  }

  const campo = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text1)' }

  return (
    <div className="empresa-aba-bloco" style={{ borderColor: 'var(--accent)' }}>
      <h4 style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FolderOpenIcon size={14} /> Para o painel do cliente · {competencia}</span>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => inputDoc.current?.click()} disabled={salvando}>
          <PaperclipIcon size={13} /> Anexar documento ao painel
        </button>
      </h4>
      <input ref={inputDoc} type="file" hidden onChange={escolherDoc} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={botaoEnvio(enviando === 'declaracao')} title="PDF da Declaração do Simples (PGDAS-D): faturamento, RBT12, alíquota e DAS no painel">
          <BarChart3Icon size={14} /> {enviando === 'declaracao' ? 'Processando…' : 'Declaração do Simples'}
          <input type="file" accept=".pdf,application/pdf" hidden disabled={!!enviando}
            onChange={(e) => { enviarDeclaracao(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <label style={botaoEnvio(enviando === 'fiscal')} title="Relatório de Situação Fiscal e/ou certidões (federal, estadual, municipal) — pode escolher vários">
          <FileTextIcon size={14} /> {enviando === 'fiscal' ? 'Processando…' : 'Situação Fiscal / CND'}
          <input type="file" accept=".pdf,application/pdf" multiple hidden disabled={!!enviando}
            onChange={(e) => { enviarFiscal(e.target.files); e.target.value = '' }} />
        </label>
        <button type="button" style={botaoEnvio(false)} onClick={() => setCndManual(true)}>
          <ShieldCheckIcon size={14} /> CND — marcar à mão
        </button>
      </div>

      {form && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px dashed var(--accent)', borderRadius: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}><PaperclipIcon size={12} /> {form.arquivo.name}</div>
          <input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Nome para o cliente (ex.: Contrato social)" style={campo} />
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}><input type="radio" checked={!form.fixo} onChange={() => setForm((f) => ({ ...f, fixo: false }))} /> Só na competência {competencia}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}><input type="radio" checked={form.fixo} onChange={() => setForm((f) => ({ ...f, fixo: true }))} /> Fixo (todos os meses)</label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</button>
            <button type="button" className="btn btn-sm btn-accent" onClick={salvarDoc} disabled={salvando || !form.titulo.trim()}>{salvando ? 'Anexando…' : 'Anexar ao painel'}</button>
          </div>
        </div>
      )}

      {docs === undefined
        ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Carregando documentos do painel…</p>
        : docs === null
          ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Para anexar documentos diversos no painel, rode supabase-schema-painel-documentos.sql no Supabase.</p>
          : docs.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Nenhum documento diverso no painel nesta competência. Use "Anexar documento ao painel" para contrato, alvará, recibos e outros.</p>
            : docs.map((d) => (
              <div key={d.id} className="empresa-aba-linha" style={{ cursor: 'default' }}>
                <span style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nomeDoc(d)}>{nomeDoc(d)}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  {d.painel_competencia ? <><CalendarIcon size={11} /> {d.painel_competencia}</> : <><PinIcon size={11} /> fixo</>} · {dataBR(d.created_at)}
                </span>
                <button type="button" className="btn btn-icon btn-ghost" title="Baixar" onClick={() => abrirLinkAssinado(d.storage_path).catch((e) => show?.('Erro: ' + e.message))}><DownloadIcon size={13} /></button>
                <button type="button" className="btn btn-icon btn-ghost" title="Tirar do painel" style={{ color: 'var(--danger)' }} onClick={() => tirarDoPainel(d)}><XIcon size={13} /></button>
              </div>
            ))}

      {cndManual && (
        <ModalCndManual cliente={cliente} competencia={competencia} onClose={() => setCndManual(false)}
          onSaved={() => { setCndManual(false); show?.('CND estadual/municipal atualizada') }} />
      )}
    </div>
  )
}
