// Mini relatório da aba da empresa: o que aconteceu hoje (ou nos últimos 7 dias).
// NFS-e emitidas pelo gestor, notas de saída e de entrada do OneFlow (tabela
// documentos_fiscais_erp, sincronizada pelo cron diário com a parametrização
// que já existe), documentos recebidos, pagamentos confirmados, guias perto do
// vencimento e o que espera o escritório na NFS-e. Regras em relatorioDoDiaRegras.js.
import { useEffect, useState } from 'react'
import {
  NewspaperIcon, FileSignatureIcon, ArrowUpRightIcon, ArrowDownLeftIcon, PaperclipIcon, CheckCircle2Icon,
  CalendarClockIcon, InboxIcon, RefreshCwIcon, AlertTriangleIcon,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { chamarNfse, listarNotasNaoEmitidas } from '../nfse/nfseApi'
import { sincronizarDocumentosFiscaisAgora } from '../contabil/documentosFiscaisApi'
import { janelaRelatorio, montarRelatorio, DIAS_GUIAS } from './relatorioDoDiaRegras'

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function carregar(clienteId, janela) {
  const desdeGuias = janela.inicio < janela.hoje ? janela.inicio : janela.hoje
  const [nfse, erp, docs, sync, esperando] = await Promise.all([
    supabase.from('nfse_notas').select('id, numero_nfse, valor, nome, atualizado_em')
      .eq('cliente_id', clienteId).eq('ambiente', 'producao').eq('estado', 'autorizada')
      .gte('atualizado_em', janela.inicioTs).limit(500),
    // sem a coluna "dados" (itens da nota, pesada)
    supabase.from('documentos_fiscais_erp')
      .select('id, tipo_movimento, numero, valor_total, data_emissao, razao_social_terceiro, situacao_documento')
      .eq('cliente_id', clienteId).gte('data_emissao', janela.inicio).limit(1000),
    supabase.from('documentos')
      .select('id, nome_arquivo, created_at, obrigacao_id, pago_em, valor_pago, valor_guia, vencimento_guia, comprovante_path, baixa_manual, status')
      .eq('cliente_id', clienteId)
      .or(`created_at.gte.${janela.inicioTs},pago_em.gte.${janela.inicioTs},and(vencimento_guia.gte.${desdeGuias},vencimento_guia.lte.${janela.limiteGuias})`)
      .limit(1000),
    // última sincronização desta empresa; sem nota dela, a do escritório
    supabase.from('documentos_fiscais_erp').select('sincronizado_em').eq('cliente_id', clienteId)
      .order('sincronizado_em', { ascending: false }).limit(1).maybeSingle()
      .then(async (r) => (r.data?.sincronizado_em ? r : supabase.from('documentos_fiscais_erp').select('sincronizado_em')
        .order('sincronizado_em', { ascending: false }).limit(1).maybeSingle())),
    // NFS-e: só para empresa configurada (sem configuração, a function responde 409 e fica de fora)
    Promise.all([
      chamarNfse('extrato_pendentes', { cliente_id: clienteId, so_contar: true }),
      listarNotasNaoEmitidas(clienteId, 'producao'),
    ]).then(([e, notas]) => ({
      pixRespondidos: e?.respondidos || 0,
      notasProntas: notas.filter((n) => (n.estado === 'validada' || n.status_validacao === 'pronto') && !(n.erros || []).some((x) => /^J[aá] emitida/.test(x))).length,
    })).catch(() => null),
  ])
  for (const r of [nfse, erp, docs]) if (r.error) throw new Error(r.error.message)
  return { nfse: nfse.data || [], erp: erp.data || [], documentos: docs.data || [], ultimaSync: sync?.data?.sincronizado_em || null, esperando }
}

export default function RelatorioDoDia({ clienteId, onAbrirModulo }) {
  const [periodo, setPeriodo] = useState('hoje')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const [aberto, setAberto] = useState(null) // chave do cartão com a lista aberta
  const [sincronizando, setSincronizando] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let ativo = true
    setDados(null); setErro(null)
    const janela = janelaRelatorio(periodo)
    carregar(clienteId, janela)
      .then((d) => ativo && setDados(montarRelatorio({ janela, ...d })))
      .catch((e) => ativo && setErro(e.message))
    return () => { ativo = false }
  }, [clienteId, periodo, versao])

  async function sincronizar() {
    setSincronizando(true)
    try { await sincronizarDocumentosFiscaisAgora(); setVersao((v) => v + 1) } catch (e) { setErro(e.message) } finally { setSincronizando(false) }
  }

  const rotuloPeriodo = periodo === 'hoje' ? 'hoje' : 'nos últimos 7 dias'
  const cartoes = dados ? [
    { chave: 'emitidas', Icon: FileSignatureIcon, titulo: 'NFS-e emitidas no gestor', bloco: dados.emitidasGestor, modulo: 'nfse',
      linha: (n) => `nº ${n.numero || '—'} · ${n.quem || 'tomador'} · ${brl(n.valor)}` },
    { chave: 'saidas', Icon: ArrowUpRightIcon, titulo: 'Notas de saída (OneFlow)', bloco: dados.saidasErp,
      linha: (n) => `${dataBR(n.data)} · nº ${n.numero || '—'} · ${n.quem || ''} · ${brl(n.valor)}` },
    { chave: 'entradas', Icon: ArrowDownLeftIcon, titulo: 'Notas de entrada (OneFlow)', bloco: dados.entradas,
      linha: (n) => `${dataBR(n.data)} · nº ${n.numero || '—'} · ${n.quem || ''} · ${brl(n.valor)}` },
    { chave: 'recebidos', Icon: PaperclipIcon, titulo: 'Documentos recebidos', bloco: dados.recebidos, modulo: 'documentos',
      linha: (d) => `${dataBR(d.data)} · ${d.nome}` },
    { chave: 'pagamentos', Icon: CheckCircle2Icon, titulo: 'Pagamentos confirmados', bloco: dados.pagamentos,
      linha: (d) => `${dataBR(d.data)} · ${d.nome} · ${brl(d.valor)} · ${d.comprovante ? 'com comprovante' : 'baixa manual'}` },
    { chave: 'guias', Icon: CalendarClockIcon, titulo: `Guias a vencer (${DIAS_GUIAS} dias)`, bloco: dados.guiasAVencer, modulo: 'entregas', semPeriodo: true,
      linha: (d) => `vence ${dataBR(d.vencimento)} · ${d.nome} · ${brl(d.valor)}` },
  ] : []

  return (
    <div className="empresa-aba-bloco">
      <h4 style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><NewspaperIcon size={14} /> Resumo da empresa {rotuloPeriodo}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {[['hoje', 'Hoje'], ['semana', '7 dias']].map(([id, rot]) => (
            <button key={id} type="button" className={`btn btn-sm ${periodo === id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setPeriodo(id)}>{rot}</button>
          ))}
        </span>
      </h4>

      {erro && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>{erro}</div>}
      {!dados && !erro && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando…</div>}

      {dados && (
        <>
          {dados.esperando && (
            <button type="button" onClick={() => onAbrirModulo?.('nfse')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--warn)',
                background: 'var(--warn-dim)', color: 'var(--text1)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
              <InboxIcon size={14} style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <span>
                <b>NFS-e esperando o escritório:</b>{' '}
                {[dados.esperando.pixRespondidos ? `${dados.esperando.pixRespondidos} PIX identificados pelo cliente` : null,
                  dados.esperando.notasProntas ? `${dados.esperando.notasProntas} nota(s) pronta(s) para emitir` : null].filter(Boolean).join(' · ')}
              </span>
            </button>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {cartoes.map((c) => {
              const qtd = c.bloco.itens.length
              return (
                <button key={c.chave} type="button" onClick={() => setAberto(aberto === c.chave ? null : c.chave)} disabled={!qtd}
                  style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: `1px solid ${aberto === c.chave ? 'var(--accent)' : 'var(--border)'}`,
                    background: 'var(--surface2, var(--bg))', cursor: qtd ? 'pointer' : 'default', font: 'inherit', color: 'var(--text1)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}><c.Icon size={12} /> {c.titulo}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: qtd ? 'var(--text1)' : 'var(--text3)' }}>{qtd}</div>
                  {c.bloco.valor > 0 && <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{brl(c.bloco.valor)}</div>}
                </button>
              )
            })}
          </div>

          {aberto && (() => {
            const c = cartoes.find((x) => x.chave === aberto)
            if (!c) return null
            return (
              <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                {c.bloco.itens.slice(0, 15).map((it) => <div key={it.id} style={{ padding: '3px 0', borderBottom: '1px dashed var(--border)' }}>{c.linha(it)}</div>)}
                {c.bloco.itens.length > 15 && <div style={{ color: 'var(--text3)', paddingTop: 4 }}>e mais {c.bloco.itens.length - 15}…</div>}
                {c.modulo && onAbrirModulo && (
                  <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() => onAbrirModulo(c.modulo)}>Abrir o módulo</button>
                )}
              </div>
            )
          })()}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11.5, color: dados.sync.atrasada ? 'var(--warn)' : 'var(--text3)', flexWrap: 'wrap' }}>
            {dados.sync.atrasada && <AlertTriangleIcon size={12} />}
            <span>
              {dados.sync.em ? `OneFlow sincronizado em ${dataHora(dados.sync.em)}` : 'OneFlow ainda não sincronizado'}
              {dados.sync.atrasada && ' — está atrasado: as notas mais novas podem não ter chegado (o token do OneFlow pode ter vencido).'}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={sincronizar} disabled={sincronizando} style={{ marginLeft: 'auto' }}>
              <RefreshCwIcon size={12} /> {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
