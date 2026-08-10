import { useState, useEffect, useMemo } from 'react'
import { PaperclipIcon, UploadCloudIcon, CheckCircle2Icon, Loader2Icon, FileIcon, Share2Icon, DownloadIcon, MessageCircleIcon, ExternalLinkIcon, SearchCheckIcon, Trash2Icon, ArchiveIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import {
  uploadArquivo, listarCandidatos, criarDocumento, confirmarDocumento,
  listarDocumentosConfirmados, listarDocumentosPendentes, excluirDocumento,
  criarLinkAssinado, itemResolvido, listarUploadsWhatsapp,
} from './documentosApi'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'

async function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsDataURL(arquivo)
  })
}

async function identificarDocumento(arquivo, candidatos) {
  const arquivoBase64 = await arquivoParaBase64(arquivo)
  const resp = await fetch('/.netlify/functions/identificar-documento', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ arquivoBase64, filename: arquivo.name, mimeType: arquivo.type, candidatos }),
  })
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}))
    throw new Error(erro.error || 'Falha ao identificar o documento.')
  }
  return resp.json()
}

const CONFIANCA_BADGE = { alta: 'badge-ok', media: 'badge-warn', baixa: 'badge-gray' }

// Fila de anexos: cada item passa por enviando -> processando -> pronto|erro.
// "pronto" já traz a sugestão da IA (empresa/tipo/candidato) pronta pra
// revisão manual antes de confirmar de fato (nunca aplica a baixa sozinho).
export default function DocumentosPage() {
  const clientes = useStore((s) => s.clientes)
  const fetchObrigacoes = useStore((s) => s.fetchObrigacoes)
  const fetchTarefas = useStore((s) => s.fetchTarefas)
  const { show } = useToast()

  const [aba, setAba] = useState('enviar') // enviar | concluidos
  const [candidatos, setCandidatos] = useState([])
  const [itens, setItens] = useState([]) // [{id, arquivo, status, storagePath, sugestao, clienteId, candidatoId, ignorar, erro}]
  const [arrastando, setArrastando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    listarCandidatos().then(setCandidatos).catch(() => {})
  }, [])

  const clientePorId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c])), [clientes])

  const processarArquivo = async (arquivo) => {
    const id = crypto.randomUUID()
    setItens((prev) => [...prev, { id, arquivo, status: 'enviando' }])
    try {
      const storagePath = await uploadArquivo(arquivo)
      setItens((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'processando', storagePath } : it)))
      const sugestao = await identificarDocumento(arquivo, candidatos)
      setItens((prev) => prev.map((it) => (it.id === id ? {
        ...it, status: 'pronto', sugestao,
        clienteId: sugestao.clienteId || '',
        candidatoId: sugestao.candidatoId || '',
        ignorar: false,
      } : it)))
    } catch (e) {
      setItens((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'erro', erro: e.message } : it)))
    }
  }

  const adicionarArquivos = (fileList) => {
    const arquivos = Array.from(fileList || [])
    arquivos.forEach(processarArquivo)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setArrastando(false)
    adicionarArquivos(e.dataTransfer.files)
  }

  const atualizarItem = (id, campo, valor) => {
    setItens((prev) => prev.map((it) => {
      if (it.id !== id) return it
      // trocar de empresa invalida o candidato escolhido (candidatos são por empresa)
      if (campo === 'clienteId') return { ...it, clienteId: valor, candidatoId: '' }
      return { ...it, [campo]: valor }
    }))
  }

  const prontosParaConfirmar = itens.filter((it) => it.status === 'pronto' && !it.ignorar)

  const handleConfirmar = async () => {
    if (prontosParaConfirmar.length === 0) return
    setConfirmando(true)
    let confirmados = 0
    let comBaixa = 0
    const falhas = []
    for (const it of prontosParaConfirmar) {
      try {
        const candidato = it.candidatoId ? candidatos.find((c) => c.id === it.candidatoId) : null
        const doc = await criarDocumento({
          nomeArquivo: it.arquivo.name,
          storagePath: it.storagePath,
          tipoMime: it.arquivo.type,
          tamanhoBytes: it.arquivo.size,
          sugestao: it.sugestao,
        })
        await confirmarDocumento(doc.id, { clienteId: it.clienteId || null, candidato })
        confirmados++
        if (candidato) comBaixa++
      } catch (e) {
        falhas.push(`${it.arquivo.name}: ${e.message}`)
      }
    }
    setItens((prev) => prev.filter((it) => !prontosParaConfirmar.some((p) => p.id === it.id)))
    await Promise.all([fetchObrigacoes(), fetchTarefas(), listarCandidatos().then(setCandidatos)])
    setConfirmando(false)
    show?.(
      falhas.length > 0
        ? `${confirmados} confirmado${confirmados !== 1 ? 's' : ''}, ${falhas.length} falhou/falharam: ${falhas.join('; ')}`
        : `${confirmados} documento${confirmados !== 1 ? 's' : ''} confirmado${confirmados !== 1 ? 's' : ''}${comBaixa > 0 ? `, ${comBaixa} deu baixa numa obrigação/tarefa` : ''}`
    )
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <PaperclipIcon size={18} /> Documentos
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Solte comprovantes, guias ou certidões — a IA sugere de qual empresa é e qual obrigação/tarefa ele resolve.
          </p>
        </div>
      </div>

      <div className="tabs" style={{ maxWidth: 560 }}>
        <button className={`tab-btn ${aba === 'enviar' ? 'active' : ''}`} onClick={() => setAba('enviar')}>Enviar</button>
        <button className={`tab-btn ${aba === 'revisar' ? 'active' : ''}`} onClick={() => setAba('revisar')}>A revisar</button>
        <button className={`tab-btn ${aba === 'concluidos' ? 'active' : ''}`} onClick={() => setAba('concluidos')}>Concluídos</button>
        <button className={`tab-btn ${aba === 'whatsapp' ? 'active' : ''}`} onClick={() => setAba('whatsapp')}>WhatsApp → Drive</button>
      </div>

      {aba === 'revisar' && <AbaRevisar />}
      {aba === 'concluidos' && <AbaConcluidos />}
      {aba === 'whatsapp' && <AbaWhatsapp />}

      {aba === 'enviar' && <>
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${arrastando ? 'var(--accent)' : 'var(--border2)'}`,
          borderRadius: 'var(--r-lg)', padding: '28px 16px', textAlign: 'center',
          background: arrastando ? 'var(--accent-dim)' : 'var(--surface)', transition: 'all .15s', marginBottom: 16,
        }}
      >
        <UploadCloudIcon size={26} color="var(--text3)" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Arraste um ou mais arquivos aqui, ou{' '}
          <label style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
            selecione
            <input type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
              onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = '' }} />
          </label>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>PDF, JPG, PNG ou WEBP</div>
      </div>

      {itens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {itens.map((it) => (
            <div key={it.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: it.status === 'pronto' ? 10 : 0 }}>
                <FileIcon size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.arquivo.name}
                </span>

                {(it.status === 'enviando' || it.status === 'processando') && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text3)' }}>
                    <Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                    {it.status === 'enviando' ? 'Enviando...' : 'Identificando...'}
                  </span>
                )}
                {it.status === 'erro' && (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>{it.erro}</span>
                )}
                {it.status === 'pronto' && (
                  <>
                    <span className={`badge ${CONFIANCA_BADGE[it.sugestao.confianca] || 'badge-gray'}`}>{it.sugestao.confianca}</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
                      <input type="checkbox" checked={!!it.ignorar} onChange={(e) => atualizarItem(it.id, 'ignorar', e.target.checked)} />
                      Ignorar
                    </label>
                  </>
                )}
              </div>

              {it.status === 'pronto' && !it.ignorar && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.6fr', gap: 8, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .4 }}>Empresa</div>
                    <select value={it.clienteId} onChange={(e) => atualizarItem(it.id, 'clienteId', e.target.value)}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
                      <option value="">Não identificada</option>
                      {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .4 }}>Tipo (sugerido pela IA)</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 0' }}>{it.sugestao.tipoDocumento}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .4 }}>Dar baixa em</div>
                    <select value={it.candidatoId} onChange={(e) => atualizarItem(it.id, 'candidatoId', e.target.value)} disabled={!it.clienteId}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', opacity: it.clienteId ? 1 : .6 }}>
                      <option value="">Nenhuma correspondência</option>
                      {candidatos.filter((c) => c.clienteId === it.clienteId).map((c) => (
                        <option key={c.id} value={c.id}>{c.rotulo}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {it.sugestao?.observacao && it.status === 'pronto' && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>"{it.sugestao.observacao}"</div>
              )}
            </div>
          ))}
        </div>
      )}

      {prontosParaConfirmar.length > 0 && (
        <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={handleConfirmar} disabled={confirmando}>
          <CheckCircle2Icon size={14} />
          {confirmando ? 'Confirmando...' : `Confirmar ${prontosParaConfirmar.length} documento${prontosParaConfirmar.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {itens.length === 0 && (
        <div className="empty">
          <p>📎</p>
          Nenhum documento enviado ainda.
        </div>
      )}
      </>}

      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

// ── Aba A revisar ────────────────────────────────────────────────────────────
// Documentos com status pendente_analise/identificado/sem_match — fila que
// sobrevive além da sessão de upload (diferente dos itens da aba Enviar,
// que só existem em estado local do browser). Alimentada tanto pelo upload
// manual (se alguém sair antes de confirmar) quanto, principalmente, pelos
// documentos que chegam pelo grupo "Documentos" do WhatsApp
// (whatsapp-webhook.js), que não têm ninguém na tela pra confirmar na hora.
function AbaRevisar() {
  const clientes = useStore((s) => s.clientes)
  const fetchObrigacoes = useStore((s) => s.fetchObrigacoes)
  const fetchTarefas = useStore((s) => s.fetchTarefas)
  const { show } = useToast()

  const [docs, setDocs] = useState(null) // null = carregando
  const [candidatos, setCandidatos] = useState([])
  const [erro, setErro] = useState(null)
  const [selecoes, setSelecoes] = useState({}) // { [docId]: { clienteId, candidatoId } }
  const [processando, setProcessando] = useState(null) // id do doc em confirmação/exclusão

  const carregar = () => {
    Promise.all([listarDocumentosPendentes(), listarCandidatos()])
      .then(([pendentes, cands]) => {
        setDocs(pendentes)
        setCandidatos(cands)
        setSelecoes(Object.fromEntries(pendentes.map((d) => [d.id, {
          clienteId: d.cliente_id || '',
          candidatoId: d.candidato_sugerido_id || '',
        }])))
      })
      .catch((e) => setErro(e.message))
  }
  useEffect(() => { carregar() }, [])

  const atualizarSelecao = (docId, campo, valor) => {
    setSelecoes((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], [campo]: valor, ...(campo === 'clienteId' ? { candidatoId: '' } : {}) },
    }))
  }

  const baixar = async (doc) => {
    try {
      const url = await criarLinkAssinado(doc.storage_path)
      window.open(url, '_blank')
    } catch (e) {
      show?.('Erro ao gerar link: ' + e.message)
    }
  }

  const confirmar = async (doc) => {
    const sel = selecoes[doc.id] || {}
    setProcessando(doc.id)
    try {
      const candidato = sel.candidatoId ? candidatos.find((c) => c.id === sel.candidatoId) : null
      await confirmarDocumento(doc.id, { clienteId: sel.clienteId || null, candidato })
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      await Promise.all([fetchObrigacoes(), fetchTarefas(), listarCandidatos().then(setCandidatos)])
      show?.(candidato ? 'Documento confirmado — baixa aplicada.' : 'Documento confirmado, sem baixa (arquivado).')
    } catch (e) {
      show?.('Erro ao confirmar: ' + e.message)
    } finally {
      setProcessando(null)
    }
  }

  const excluir = async (doc) => {
    if (!window.confirm(`Excluir "${doc.nome_arquivo}"? Essa ação não pode ser desfeita.`)) return
    setProcessando(doc.id)
    try {
      await excluirDocumento(doc.id)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      show?.('Documento excluído.')
    } catch (e) {
      show?.('Erro ao excluir: ' + e.message)
    } finally {
      setProcessando(null)
    }
  }

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!docs) return <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>
  if (docs.length === 0) return (
    <div className="empty">
      <p>🔎</p>
      Nenhum documento aguardando revisão.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 12, color: 'var(--text3)' }}>
        Documentos identificados automaticamente (upload manual não confirmado, ou chegados pelo grupo "Documentos" do WhatsApp) — confira a sugestão da IA e confirme pra dar baixa.
      </p>
      {docs.map((doc) => {
        const sel = selecoes[doc.id] || { clienteId: '', candidatoId: '' }
        return (
          <div key={doc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <FileIcon size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.tipo_documento_sugerido || doc.nome_arquivo}
              </span>
              {doc.confianca && <span className={`badge ${CONFIANCA_BADGE[doc.confianca] || 'badge-gray'}`}>{doc.confianca}</span>}
              <button className="btn btn-ghost btn-sm" onClick={() => baixar(doc)} title="Baixar arquivo original">
                <DownloadIcon size={13} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 8, alignItems: 'end', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .4 }}>Empresa</div>
                <select value={sel.clienteId} onChange={(e) => atualizarSelecao(doc.id, 'clienteId', e.target.value)}
                  style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
                  <option value="">Não identificada</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: .4 }}>Dar baixa em</div>
                <select value={sel.candidatoId} onChange={(e) => atualizarSelecao(doc.id, 'candidatoId', e.target.value)} disabled={!sel.clienteId}
                  style={{ width: '100%', fontSize: 12, padding: '6px 8px', opacity: sel.clienteId ? 1 : .6 }}>
                  <option value="">Nenhuma correspondência</option>
                  {candidatos.filter((c) => c.clienteId === sel.clienteId).map((c) => (
                    <option key={c.id} value={c.id}>{c.rotulo}</option>
                  ))}
                </select>
              </div>
            </div>

            {doc.observacao_ia && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontStyle: 'italic' }}>"{doc.observacao_ia}"</div>
            )}

            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => excluir(doc)} disabled={processando === doc.id} title="Excluir sem arquivar">
                <Trash2Icon size={13} color="var(--danger)" /> Excluir
              </button>
              <button className="btn btn-accent btn-sm" onClick={() => confirmar(doc)} disabled={processando === doc.id}>
                {sel.candidatoId ? <SearchCheckIcon size={13} /> : <ArchiveIcon size={13} />}
                {processando === doc.id ? 'Confirmando...' : sel.candidatoId ? 'Confirmar e dar baixa' : 'Confirmar (arquivar)'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Aba Concluídos ───────────────────────────────────────────────────────────
// Documentos já confirmados (deram baixa ou foram arquivados), com o item
// que cada um resolveu e ações de baixar/compartilhar o arquivo original.
function AbaConcluidos() {
  const [docs, setDocs] = useState(null) // null = carregando
  const [erro, setErro] = useState(null)
  const { show } = useToast()

  useEffect(() => {
    listarDocumentosConfirmados().then(setDocs).catch((e) => setErro(e.message))
  }, [])

  const baixar = async (doc) => {
    try {
      const url = await criarLinkAssinado(doc.storage_path)
      window.open(url, '_blank')
    } catch (e) {
      show?.('Erro ao gerar link: ' + e.message)
    }
  }

  const compartilhar = (doc) => {
    const url = `${window.location.origin}${window.location.pathname}?doc=${doc.id}`
    const label = doc.tipo_documento_sugerido || doc.nome_arquivo
    const mensagem = `Olá! Segue ${label}${doc.clientes?.nome ? ` de ${doc.clientes.nome}` : ''} pra conferência:\n${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!docs) return <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>
  if (docs.length === 0) return (
    <div className="empty">
      <p>✅</p>
      Nenhum documento confirmado ainda.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {docs.map((doc) => (
        <div key={doc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileIcon size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{doc.tipo_documento_sugerido || doc.nome_arquivo}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {doc.clientes?.nome || '—'}
              {itemResolvido(doc) && <> · {itemResolvido(doc)}</>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => baixar(doc)} title="Baixar arquivo original">
            <DownloadIcon size={13} /> Baixar
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => compartilhar(doc)} title="Compartilhar via WhatsApp">
            <Share2Icon size={13} /> Compartilhar
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Aba WhatsApp → Drive ─────────────────────────────────────────────────────
// Histórico dos arquivos enviados no grupo "Documentos" do WhatsApp e
// subidos automaticamente pro Google Drive (netlify/functions/whatsapp-webhook.js).
// Sistema separado do fluxo de upload manual acima — só consulta, sem ações.
function AbaWhatsapp() {
  const [uploads, setUploads] = useState(null) // null = carregando
  const [erro, setErro] = useState(null)

  useEffect(() => {
    listarUploadsWhatsapp().then(setUploads).catch((e) => setErro(e.message))
  }, [])

  const formatarData = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!uploads) return <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>
  if (uploads.length === 0) return (
    <div className="empty">
      <p>💬</p>
      Nenhum arquivo enviado pelo grupo "Documentos" do WhatsApp ainda.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 12, color: 'var(--text3)' }}>
        Todo arquivo enviado no grupo "Documentos" do WhatsApp sobe automaticamente pro Google Drive. Aqui é só o histórico — não tem vínculo com empresas/obrigações.
      </p>
      {uploads.map((up) => (
        <div key={up.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <MessageCircleIcon size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {up.nome_arquivo}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {formatarData(up.created_at)}{up.remetente && <> · {up.remetente}</>}
            </div>
          </div>
          {up.drive_link && (
            <a className="btn btn-ghost btn-sm" href={up.drive_link} target="_blank" rel="noreferrer" title="Abrir no Google Drive">
              <ExternalLinkIcon size={13} /> Abrir no Drive
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
