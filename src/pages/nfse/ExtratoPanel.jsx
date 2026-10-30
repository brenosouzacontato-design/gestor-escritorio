import { useMemo, useState } from 'react'
import { LandmarkIcon, PrinterIcon, XIcon } from 'lucide-react'
import { useToast } from '../../components/shared'
import { chamarNfse } from './nfseApi'

// Emissão por extrato bancário: o escritório envia o extrato (PDF ou OFX), cada PIX recebido vira
// uma linha com quem pagou (sugerido pelo cadastro e pelas notas anteriores), e os PIX conferidos
// viram um lote, que segue para "Conferir e emitir" como qualquer importação.
// Servidor: ações extrato_analisar e extrato_criar_lote (netlify/functions/nfse.js, lib/nfse/extrato.js).

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const suave = { color: 'var(--text3)', fontSize: 12 }
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const cpfFmt = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || '')
const soDig = (v) => String(v || '').replace(/\D/g, '')
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false
  for (const n of [9, 10]) {
    const soma = c.slice(0, n).split('').reduce((s, x, i) => s + Number(x) * (n + 1 - i), 0)
    if (((soma * 10) % 11) % 10 !== Number(c[n])) return false
  }
  return true
}

const SITUACAO = {
  identificado: ['Identificado', 'var(--ok-dim)', 'var(--ok)'],
  provavel: ['Confira', 'var(--info-dim)', 'var(--info)'],
  escolher: ['Escolha quem pagou', 'var(--warn-dim)', 'var(--warn)'],
  sem_cadastro: ['Não identificado', 'var(--warn-dim)', 'var(--warn)'],
  ja_tem_nota: ['Já tem nota', 'var(--surface3)', 'var(--ok)'],
  nao_receita: ['Não é de cliente', 'var(--surface2)', 'var(--text3)'],
}
const FILTROS = [
  ['', 'Todos'],
  ['emitir', 'Marcados para emitir'],
  ['voce', 'Precisam de você'],
  ['ja_tem_nota', 'Já têm nota'],
  ['nao_receita', 'Não são de cliente'],
]
const precisaDeVoce = (l, e) => e.emitir && (!e.nome || !cpfValido(e.cpf))

// Texto do PDF linha a linha, na ordem da página (pdf.js, o mesmo leitor do extrato contábil)
async function textoDoArquivo(arquivo) {
  if (/\.pdf$/i.test(arquivo.name)) {
    const { lerLinhasPdf } = await import('../contabil/extratoNubank')
    const paginas = await lerLinhasPdf(await arquivo.arrayBuffer())
    return paginas.flat().map((l) => l.itens.map((i) => i.s).join(' ')).join('\n')
  }
  return arquivo.text()
}

export default function ExtratoPanel({ clienteId, onLoteCriado, onFechar }) {
  const { show } = useToast()
  const [arquivo, setArquivo] = useState('')
  const [lancamentos, setLancamentos] = useState(null)
  const [pessoas, setPessoas] = useState([])
  const [escolhas, setEscolhas] = useState({}) // id → { emitir, nome, cpf, data, salvar, digitar }
  const [filtro, setFiltro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function analisar(f) {
    if (!f) return
    setOcupado(true)
    try {
      const texto = await textoDoArquivo(f)
      const r = await chamarNfse('extrato_analisar', { cliente_id: clienteId, texto })
      setArquivo(f.name)
      setLancamentos(r.lancamentos)
      setPessoas(r.pessoas || [])
      setEscolhas(Object.fromEntries(r.lancamentos.map((l) => [l.id, {
        emitir: l.emitir, nome: l.sugerido?.nome || '', cpf: l.sugerido?.cpf || '', data: l.dataPix, salvar: true, digitar: l.situacao === 'sem_cadastro',
      }])))
      setFiltro('')
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  const mudar = (id, campos) => setEscolhas((s) => ({ ...s, [id]: { ...s[id], ...campos } }))

  const receitas = useMemo(() => (lancamentos || []).filter((l) => l.situacao !== 'nao_receita'), [lancamentos])
  const marcados = useMemo(() => (lancamentos || []).filter((l) => escolhas[l.id]?.emitir), [lancamentos, escolhas])
  const pendentes = marcados.filter((l) => precisaDeVoce(l, escolhas[l.id]))
  const soma = (ls) => ls.reduce((s, l) => s + Number(l.valor), 0)
  const visiveis = (lancamentos || []).filter((l) => {
    const e = escolhas[l.id] || {}
    if (filtro === 'emitir') return e.emitir
    if (filtro === 'voce') return precisaDeVoce(l, e) || (!e.emitir && ['escolher', 'sem_cadastro'].includes(l.situacao))
    if (filtro) return l.situacao === filtro
    return true
  })
  const contagem = {
    '': (lancamentos || []).length,
    emitir: marcados.length,
    voce: (lancamentos || []).filter((l) => precisaDeVoce(l, escolhas[l.id] || {}) || (!escolhas[l.id]?.emitir && ['escolher', 'sem_cadastro'].includes(l.situacao))).length,
    ja_tem_nota: (lancamentos || []).filter((l) => l.situacao === 'ja_tem_nota').length,
    nao_receita: (lancamentos || []).filter((l) => l.situacao === 'nao_receita').length,
  }

  async function criarLote() {
    const semNome = marcados.filter((l) => !escolhas[l.id].nome.trim())
    if (semNome.length) { show(`Falta o nome de quem pagou em ${semNome.length} PIX marcado(s)`); setFiltro('voce'); return }
    const cpfErrado = marcados.filter((l) => escolhas[l.id].cpf && !cpfValido(escolhas[l.id].cpf))
    if (cpfErrado.length) { show(`CPF inválido em ${cpfErrado.length} PIX marcado(s)`); setFiltro('voce'); return }
    setOcupado(true)
    try {
      const r = await chamarNfse('extrato_criar_lote', {
        cliente_id: clienteId, arquivo,
        itens: marcados.map((l) => {
          const e = escolhas[l.id]
          return { nome: e.nome.trim(), cpf: e.cpf, data: e.data, valor: l.valor, descricao_extrato: l.descricao, nome_extrato: l.nomeExtrato,
            salvar_cadastro: e.digitar && e.salvar }
        }),
      })
      show(`Lote criado com ${marcados.length} nota(s)${r.salvos ? ` · ${r.salvos} cliente(s) novo(s) no cadastro` : ''}. Confira e emita abaixo.`)
      setLancamentos(null)
      onLoteCriado(r.lote_id)
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  function imprimir() {
    const linhas = (lancamentos || []).map((l) => {
      const e = escolhas[l.id] || {}
      return `<tr><td>${e.emitir ? '✔' : ''}</td><td>${dataBR(e.data || l.dataPix)}</td><td>${esc(l.descricao)}</td><td style="text-align:right">${brl(l.valor)}</td>`
        + `<td>${esc(e.nome || '')}${e.cpf ? `<br><small>${cpfFmt(e.cpf)}</small>` : ''}</td><td>${SITUACAO[l.situacao][0]}<br><small>${esc(l.motivo)}</small></td></tr>`
    }).join('')
    const w = window.open('', '_blank')
    if (!w) { show('O navegador bloqueou a janela do relatório'); return }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Conferência do extrato · ${esc(arquivo)}</title>
      <style>body{font:12px system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5px 6px;vertical-align:top}th{background:#f2f2f2;text-align:left}small{color:#666}h1{font-size:16px}p{margin:4px 0}</style>
      <h1>Conferência do extrato para emissão de NFS-e</h1>
      <p>Arquivo: ${esc(arquivo)} · emitido em ${new Date().toLocaleString('pt-BR')}</p>
      <p>PIX recebidos: ${receitas.length} (${brl(soma(receitas))}) · Marcados para emitir: ${marcados.length} (${brl(soma(marcados))}) · Já têm nota: ${contagem.ja_tem_nota}</p>
      <table><thead><tr><th>Emitir</th><th>Data</th><th>No extrato</th><th>Valor</th><th>Cliente</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table>`)
    w.document.close()
    w.focus()
    w.print()
  }

  if (!lancamentos) {
    return (
      <div style={{ ...card, background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <LandmarkIcon size={16} /><b style={{ fontSize: 13 }}>Emitir pelo extrato bancário</b>
          {onFechar && <button className="btn btn-icon btn-ghost" style={{ marginLeft: 'auto' }} title="Fechar" onClick={onFechar}><XIcon size={14} /></button>}
        </div>
        <p style={{ ...suave, margin: '0 0 10px' }}>
          Envie o extrato da conta (PDF do Itaú ou OFX de qualquer banco). Cada PIX recebido vira uma linha com quem pagou, conferida
          pelo cadastro de clientes e pelas notas anteriores. Você confere, marca o que emitir e cria o lote.
        </p>
        <input type="file" accept=".pdf,.ofx,.txt" disabled={ocupado} style={{ width: 'auto' }}
          onChange={(e) => { analisar(e.target.files[0]); e.target.value = '' }} />
        {ocupado && <span style={{ ...suave, marginLeft: 8 }}>Lendo o extrato…</span>}
      </div>
    )
  }

  const resumo = [
    ['PIX recebidos', receitas.length, soma(receitas), 'var(--text1)'],
    ['Marcados para emitir', marcados.length, soma(marcados), 'var(--accent)'],
    ['Já têm nota', contagem.ja_tem_nota, soma((lancamentos || []).filter((l) => l.situacao === 'ja_tem_nota')), 'var(--ok)'],
    ['Precisam de você', contagem.voce, null, contagem.voce ? 'var(--warn)' : 'var(--text3)'],
  ]

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <LandmarkIcon size={16} /><b style={{ fontSize: 14 }}>Conferência do extrato</b>
        <span style={suave}>{arquivo}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={imprimir}><PrinterIcon size={14} /> Imprimir relatório</button>
          <button className="btn btn-ghost" onClick={() => setLancamentos(null)}>Trocar extrato</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        {resumo.map(([rot, n, v, cor]) => (
          <div key={rot} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={suave}>{rot}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: cor }}>{n}{v !== null && <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6 }}>{brl(v)}</span>}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTROS.map(([k, rot]) => (
          <button key={k || 'todos'} className={`btn ${filtro === k ? 'btn-accent' : 'btn-ghost'}`} style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setFiltro(k)}>
            {rot} <span style={{ opacity: 0.7 }}>({contagem[k]})</span>
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
              <th style={th}>Emitir</th><th style={th}>Data</th><th style={th}>No extrato</th><th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={th}>Quem pagou (sai na nota)</th><th style={th}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => <Linha key={l.id} l={l} e={escolhas[l.id]} pessoas={pessoas} mudar={(c) => mudar(l.id, c)} />)}
            {!visiveis.length && <tr><td colSpan={6} style={{ ...td, ...suave }}>Nada aqui.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-accent" disabled={ocupado || !marcados.length} onClick={criarLote}>
          Criar lote com {marcados.length} nota{marcados.length === 1 ? '' : 's'} · {brl(soma(marcados))}
        </button>
        <span style={suave}>
          {pendentes.length ? `${pendentes.length} marcado(s) sem nome ou CPF: a nota entra como "falta dado" e você completa antes de emitir. ` : ''}
          Nada é emitido agora: o lote vai para "Conferir e emitir".
        </span>
      </div>
    </div>
  )
}

const th = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function Linha({ l, e, pessoas, mudar }) {
  const [rot, bg, cor] = SITUACAO[l.situacao]
  const foraDeUso = l.situacao === 'nao_receita'
  const opcoes = [...l.candidatos, ...pessoas.filter((p) => !l.candidatos.some((c) => c.cpf === p.cpf))]
  const cpfRuim = e.cpf && !cpfValido(e.cpf)
  return (
    <tr style={{ opacity: e.emitir || l.situacao === 'escolher' || l.situacao === 'sem_cadastro' ? 1 : 0.6 }}>
      <td style={td}><input type="checkbox" checked={!!e.emitir} onChange={(ev) => mudar({ emitir: ev.target.checked })} title={foraDeUso ? 'Não parece pagamento de cliente, mas pode marcar' : ''} /></td>
      <td style={td}>
        <input type="date" value={e.data} onChange={(ev) => mudar({ data: ev.target.value })} style={{ padding: '2px 4px', fontSize: 12, width: 130 }} title="Data do atendimento na nota (veio a data do PIX)" />
      </td>
      <td style={{ ...td, maxWidth: 240 }}><div>{l.descricao}</div>{l.data !== l.dataPix && <div style={suave}>lançado em {dataBR(l.data)}</div>}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{brl(l.valor)}</td>
      <td style={{ ...td, minWidth: 260 }}>
        {e.digitar ? (
          <div style={{ display: 'grid', gap: 4 }}>
            <input placeholder="Nome completo de quem pagou" value={e.nome} onChange={(ev) => mudar({ nome: ev.target.value })} style={{ padding: '3px 6px', fontSize: 12 }} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input placeholder="CPF" value={cpfFmt(e.cpf)} onChange={(ev) => mudar({ cpf: soDig(ev.target.value).slice(0, 11) })}
                style={{ padding: '3px 6px', fontSize: 12, width: 130, borderColor: cpfRuim ? 'var(--danger)' : undefined }} />
              <label style={{ ...suave, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={e.salvar} onChange={(ev) => mudar({ salvar: ev.target.checked })} /> salvar no cadastro
              </label>
            </div>
            {opcoes.length > 0 && <button className="btn btn-ghost" style={{ padding: 0, fontSize: 11, justifySelf: 'start' }} onClick={() => mudar({ digitar: false, nome: '', cpf: '' })}>escolher do cadastro</button>}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 2 }}>
            <select value={e.cpf} onChange={(ev) => {
              if (ev.target.value === '__digitar') return mudar({ digitar: true, nome: '', cpf: '' })
              const p = opcoes.find((x) => x.cpf === ev.target.value)
              mudar({ cpf: p?.cpf || '', nome: p?.nome || '', emitir: p ? true : e.emitir })
            }} style={{ padding: '3px 6px', fontSize: 12 }}>
              <option value="">{l.candidatos.length ? '— escolha quem pagou —' : '— escolher cliente —'}</option>
              {l.candidatos.length > 0 && <optgroup label={`Começam com "${l.nomeExtrato}"`}>
                {l.candidatos.map((c) => <option key={c.cpf} value={c.cpf}>{c.nome} · {cpfFmt(c.cpf)}{c.notas ? ` · ${c.notas} nota(s)` : ''}</option>)}
              </optgroup>}
              {!l.candidatos.length && e.cpf && !pessoas.some((p) => p.cpf === e.cpf) && <option value={e.cpf}>{e.nome} · {cpfFmt(e.cpf)}</option>}
              <optgroup label="Todos os clientes">
                {pessoas.filter((p) => !l.candidatos.some((c) => c.cpf === p.cpf)).map((p) => <option key={p.cpf} value={p.cpf}>{p.nome} · {cpfFmt(p.cpf)}</option>)}
              </optgroup>
              <option value="__digitar">Outra pessoa (digitar nome e CPF)…</option>
            </select>
            {e.cpf && <span style={suave}>CPF {cpfFmt(e.cpf)}</span>}
          </div>
        )}
      </td>
      <td style={{ ...td, maxWidth: 260 }}>
        <span style={{ background: bg, color: cor, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{rot}</span>
        <div style={{ ...suave, marginTop: 3 }}>{l.motivo}</div>
      </td>
    </tr>
  )
}
