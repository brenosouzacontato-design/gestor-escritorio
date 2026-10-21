import { useRef, useState } from 'react'
import { PaperclipIcon, UploadCloudIcon, FileIcon, DownloadIcon, Loader2Icon, XIcon } from 'lucide-react'

// Anexos de uma obrigação ou tarefa — o mesmo visual no gestor (cards do
// modal da empresa em Empresas.jsx) e no link da carteira
// (PainelCarteiraPage.jsx). Só apresentação: quem usa passa como enviar e
// abrir o arquivo (no gestor, direto no Supabase com login; no link da
// carteira, pela function carteira-acao).

// Botão 📎 com a quantidade de anexos, pra colocar no card.
export function BotaoAnexos({ qtd = 0, onClick, tamanho = 12 }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }}
      title={qtd > 0 ? `${qtd} anexo${qtd !== 1 ? 's' : ''} — ver ou anexar outro` : 'Anexar documento'}
      style={{ background: qtd > 0 ? 'var(--accent-dim)' : 'none', border: 'none', cursor: 'pointer', padding: qtd > 0 ? '1px 6px' : 2,
        borderRadius: 99, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
        color: qtd > 0 ? 'var(--accent)' : 'var(--text3)', fontSize: 10.5, fontWeight: 700 }}>
      <PaperclipIcon size={tamanho} />{qtd > 0 && qtd}
    </button>
  )
}

const fmtTamanho = (b) => !b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`

// onEnviar(arquivo, { darBaixa }) → Promise; onAbrir(anexo) → abre/baixa
export function AnexosItemModal({ titulo, subtitulo, anexos, concluido, onEnviar, onAbrir, onClose }) {
  const inputRef = useRef(null)
  const [arquivos, setArquivos] = useState([])
  const [darBaixa, setDarBaixa] = useState(!concluido)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const [arrastando, setArrastando] = useState(false)

  const enviar = async () => {
    if (arquivos.length === 0) return
    setEnviando(true)
    setErro(null)
    try {
      for (let i = 0; i < arquivos.length; i++) {
        // baixa só junto com o último arquivo, uma vez
        await onEnviar(arquivos[i], { darBaixa: darBaixa && !concluido && i === arquivos.length - 1 })
      }
      setArquivos([])
      onClose()
    } catch (e) {
      setErro(e.message)
    }
    setEnviando(false)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: 18, boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PaperclipIcon size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)' }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{subtitulo}</div>}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 2 }}><XIcon size={16} /></button>
        </div>

        {/* anexos já enviados */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {anexos.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhum documento anexado ainda.</div>}
          {anexos.map((a) => (
            <button key={a.id} type="button" onClick={() => onAbrir(a)} title="Abrir / baixar"
              style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', width: '100%',
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
              <FileIcon size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome_arquivo}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>
                  {new Date(a.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {a.tamanho_bytes ? ` · ${fmtTamanho(a.tamanho_bytes)}` : ''}
                </span>
              </span>
              <DownloadIcon size={13} color="var(--text3)" style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>

        {/* enviar novos */}
        <div onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); setArquivos([...arquivos, ...e.dataTransfer.files]) }}
          style={{ border: `1.5px dashed ${arrastando ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 10, padding: '14px 12px', textAlign: 'center',
            cursor: 'pointer', background: arrastando ? 'var(--accent-dim)' : 'transparent' }}>
          <UploadCloudIcon size={20} color="var(--text3)" />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text1)', marginTop: 4 }}>Anexar documento</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Toque pra escolher ou arraste o arquivo aqui (até 25 MB)</div>
          <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { setArquivos([...arquivos, ...e.target.files]); e.target.value = '' }} />
        </div>
        {arquivos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {arquivos.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
                <FileIcon size={12} /> <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ color: 'var(--text3)' }}>{fmtTamanho(f.size)}</span>
                <button type="button" onClick={() => setArquivos(arquivos.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0 }}><XIcon size={12} /></button>
              </div>
            ))}
          </div>
        )}
        {!concluido && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text1)', marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={darBaixa} onChange={(e) => setDarBaixa(e.target.checked)} />
            Dar baixa ao anexar (marcar como concluída)
          </label>
        )}
        {erro && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Fechar</button>
          <button type="button" className="btn btn-accent" style={{ flex: 2, justifyContent: 'center' }} onClick={enviar} disabled={arquivos.length === 0 || enviando}>
            {enviando ? <><Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Enviando...</> : `Enviar ${arquivos.length > 1 ? `${arquivos.length} arquivos` : 'arquivo'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
