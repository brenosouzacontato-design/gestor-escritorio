import { useState, useEffect, useMemo } from 'react'
import { PaperclipIcon, UploadCloudIcon, CheckCircle2Icon, Loader2Icon, FileIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import { uploadArquivo, listarCandidatos, criarDocumento, confirmarDocumento } from './documentosApi'

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

      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}
