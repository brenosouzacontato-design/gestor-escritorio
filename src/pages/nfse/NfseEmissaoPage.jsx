import { useEffect, useMemo, useState } from 'react'
import { FileSignatureIcon, UploadIcon, ShieldCheckIcon, SendIcon, RefreshCwIcon, CopyIcon, Trash2Icon, FileCodeIcon, SettingsIcon, CheckCircleIcon, AlertTriangleIcon } from 'lucide-react'
import { useStore } from '../../store'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import { Modal, useToast } from '../../components/shared'
import { chamarNfse, listarLotes, listarNotas, baixarXml, arquivoParaBase64, totais } from './nfseApi'
import { baixarNfse } from '../painel/nfsePainelApi'
import TomadoresPanel from './TomadoresPanel'
import { chavePainelPorId, urlPublica } from '../../lib/linksPublicos'

// Emissão de NFS-e pela API da Sefin Nacional, por empresa. Ver docs/nfse-emissao.md.
// Tudo que grava passa pela function nfse (login conferido no servidor); a tela só lê do Supabase.

const brl = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const cpfFmt = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || '')
const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

const COR_STATUS = {
  pronto: ['var(--ok-dim)', 'var(--ok)'],
  pendente: ['var(--warn-dim)', 'var(--warn)'],
  invalido: ['var(--danger-dim)', 'var(--danger)'],
  autorizada: ['var(--ok)', '#fff'],
  rejeitada: ['var(--danger-dim)', 'var(--danger)'],
  indeterminada: ['var(--warn-dim)', 'var(--warn)'],
  enviada: ['var(--warn-dim)', 'var(--warn)'],
  numero_reservado: ['var(--surface3)', 'var(--text2)'],
  cancelada: ['var(--surface3)', 'var(--text3)'],
  ja_emitida: ['var(--surface3)', 'var(--ok)'],
  complementar: ['var(--info-dim)', 'var(--info)'],
}
const EDITAVEL = (n) => n.estado === 'importada' || n.estado === 'validada'

// Situação mostrada na tela. "Já emitida" e "Complementar?" vêm da validação no servidor (inclusive
// contra as notas do Ambiente Nacional emitidas fora do gestor) e travam a emissão.
const JA_EMITIDA = 'Já emitida:'
const COMPLEMENTAR = 'Complementar?'
function situacao(n) {
  if (!EDITAVEL(n)) return n.estado
  if (n.erros.some((e) => e.startsWith(JA_EMITIDA))) return 'ja_emitida'
  if (n.erros.some((e) => e.startsWith(COMPLEMENTAR))) return 'complementar'
  return n.status_validacao
}
const ROTULO = { pronto: 'pronta', pendente: 'falta dado', invalido: 'com erro', ja_emitida: 'já emitida', complementar: 'decidir', autorizada: 'emitida', rejeitada: 'rejeitada', indeterminada: 'sem resposta', enviada: 'enviando', numero_reservado: 'reservada', cancelada: 'cancelada' }

// Trecho útil da mensagem da validação ("… já tem NFS-e nº 12 de R$ 2.500,00 (…)"), sem a instrução
const anteriorDe = (n, prefixo) => (n.erros.find((e) => e.startsWith(prefixo)) || '')
  .slice(prefixo.length).replace(/\s*(Se faltar só a diferença|Remova do lote|O valor já emitido cobre|Confira com).*$/, '').trim()
// Valor da diferença sugerida na "Complementar?" (null quando o já emitido cobre a nota)
const diferencaDe = (n) => ((n.erros.find((e) => e.startsWith(COMPLEMENTAR)) || '').match(/mude o valor para (R\$\s?[\d.,]+)/) || [])[1] || null

// Abas da conferência: o que fazer com cada nota
const ABAS = [
  ['', 'Todas', () => true],
  ['pronto', 'Prontas', (n) => situacao(n) === 'pronto'],
  ['pendente', 'Falta dado', (n) => situacao(n) === 'pendente'],
  ['decidir', 'Precisa decidir', (n) => ['complementar', 'ja_emitida'].includes(situacao(n)) && !n.ciente_em],
  ['invalido', 'Com erro', (n) => situacao(n) === 'invalido'],
  ['emitidas', 'Emitidas', (n) => n.estado === 'autorizada'],
  ['problema', 'Rejeitadas / sem resposta', (n) => ['rejeitada', 'indeterminada', 'enviada'].includes(n.estado)],
  ['ciente', 'Já emitidas (cliente ciente)', (n) => !!n.ciente_em && EDITAVEL(n)],
]
const DICA_ABA = {
  pronto: 'Conferidas e prontas. Use "Emitir" para mandar todas (ou só as que você marcar).',
  pendente: 'Falta algum dado (borda tracejada). Preencha na própria linha ou espere o cliente completar no painel.',
  decidir: 'O paciente já tem NFS-e parecida. Escolha em cada linha: emitir só a diferença, emitir o valor cheio (é outro serviço) ou remover do lote.',
  invalido: 'Algum dado está errado (CPF, data, valor…). Corrija na linha.',
  problema: 'A Sefin recusou ou não respondeu. Rejeitada: copie para corrigir. Sem resposta: reconsulte.',
  ciente: 'O cliente confirmou no painel que estas já tinham sido emitidas. Pode remover do lote.',
}
// Campo da tabela → nome usado nas pendências da validação
const PENDENCIA = { nome: 'Nome', cpf: 'CPF', data: 'Data', valor: 'Valor', descricao: 'Descrição', endereco: 'Endereço' }

function Pill({ tipo, children }) {
  const [bg, cor] = COR_STATUS[tipo] || ['var(--surface2)', 'var(--text3)']
  return <span style={{ background: bg, color: cor, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
}

function AmbienteBadge({ ambiente, grande = false }) {
  const prod = ambiente === 'producao'
  return (
    <span style={{
      background: prod ? 'var(--danger)' : 'var(--warn-dim)', color: prod ? '#fff' : 'var(--warn)',
      border: prod ? 'none' : '1px solid var(--warn)', borderRadius: 6, fontWeight: 800, letterSpacing: '.04em',
      padding: grande ? '10px 16px' : '4px 10px', fontSize: grande ? 18 : 12, display: 'inline-block',
    }}>{prod ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}</span>
  )
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const titulo = { fontSize: 14, fontWeight: 700, color: 'var(--text1)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }
const suave = { color: 'var(--text3)', fontSize: 12 }

// ---------------------------------------------------------------- configuração da empresa e certificado

function Configuracao({ clienteId, status, onAtualizado }) {
  const { show } = useToast()
  const emp = status.empresa
  const [aberto, setAberto] = useState(!status.configurada)
  const [form, setForm] = useState({ serie_dps: emp?.serie_dps || '900', regra_competencia: emp?.regra_competencia || 'mes_do_atendimento', ambiente: emp?.ambiente || 'homologacao', whatsapp_origem: emp?.whatsapp_origem || '', descricao_padrao: emp?.descricao_padrao || '' })
  // Simples Nacional no leiaute da NT 009 (obrigatórios para ME/EPP ou opção pendente)
  const sp0 = emp?.servico_padrao || {}
  const [simples, setSimples] = useState({
    regApIBSCBSSN: sp0.regApIBSCBSSN || '', cAtvSN: sp0.cAtvSN || '',
    cNBS: sp0.cNBS || '', cIndOp: sp0.cIndOp || '', CST: sp0.CST || '', cClassTrib: sp0.cClassTrib || '',
  })
  const faltaIbsCbs = status.configurada && (!sp0.cIndOp || !sp0.CST || !sp0.cClassTrib)
  const optanteSimples = ['3', '4'].includes(emp?.gabarito?.op_simp_nac)
  const faltaSimples = optanteSimples && (!emp?.servico_padrao?.regApIBSCBSSN || !emp?.servico_padrao?.cAtvSN)
  const [gabarito, setGabarito] = useState(null)
  const [pfx, setPfx] = useState(null)
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { setAberto(!status.configurada) }, [clienteId, status.configurada])

  async function salvarEmpresa() {
    if (form.ambiente === 'producao' && emp?.ambiente !== 'producao'
      && !window.confirm('Mudar para PRODUÇÃO: as próximas notas emitidas serão notas fiscais reais. Confirmar?')) return
    setSalvando(true)
    try {
      const dados = { cliente_id: clienteId, ...form, servico_padrao: simples }
      if (gabarito) dados.gabarito_xml = await gabarito.text()
      onAtualizado(await chamarNfse('salvar_empresa', dados))
      setGabarito(null)
      show('Configuração salva')
      setAberto(false)
    } catch (e) { show(e.message) } finally { setSalvando(false) }
  }

  async function salvarCertificado() {
    if (!pfx || !senha) { show('Escolha o arquivo .pfx e digite a senha'); return }
    setSalvando(true)
    try {
      onAtualizado(await chamarNfse('salvar_certificado', { cliente_id: clienteId, pfx_base64: await arquivoParaBase64(pfx), senha }))
      setPfx(null)
      setSenha('')
      show('Certificado salvo (cifrado no servidor)')
    } catch (e) { show(e.message) } finally { setSalvando(false) }
  }

  const cert = status.certificado
  const tudoCerto = status.configurada && cert && !cert.bloqueios.length && !faltaIbsCbs && !faltaSimples
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ ...titulo, margin: 0 }}><SettingsIcon size={16} /> Configuração</h3>
        {tudoCerto
          ? <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircleIcon size={14} /> Tudo certo para emitir</span>
          : <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangleIcon size={14} /> {status.configurada ? 'Falta ajustar — veja abaixo' : 'Empresa ainda não configurada'}</span>}
        {status.configurada && aberto && (
          <span style={{ ...suave, flexBasis: '100%' }}>
            CNPJ {emp.cnpj} · município {emp.codigo_municipio} · serviço {emp.servico_padrao?.cTribNac} · série DPS {emp.serie_dps}
            {' · '}competência padrão: {emp.regra_competencia === 'mes_da_emissao' ? 'data da emissão' : 'data do atendimento'}
            {optanteSimples && emp.servico_padrao?.cAtvSN && <>{' · '}Simples: IBS/CBS {emp.servico_padrao.regApIBSCBSSN}, atividade {emp.servico_padrao.cAtvSN}</>}
          </span>
        )}
        {faltaIbsCbs && (
          <div style={{ flexBasis: '100%', color: 'var(--danger)', fontSize: 12 }}>
            Falta informar IBS/CBS (cIndOp, CST e cClassTrib), obrigatório para competência a partir de 10/2026. Clique em Editar.
          </div>
        )}
        {faltaSimples && (
          <div style={{ flexBasis: '100%', color: 'var(--danger)', fontSize: 12 }}>
            Falta informar o regime de IBS/CBS e a atividade do Simples Nacional (obrigatórios no leiaute novo da NFS-e). Clique em Editar.
          </div>
        )}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAberto((a) => !a)}>{aberto ? 'Fechar' : 'Ver / editar'}</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <ShieldCheckIcon size={14} style={{ verticalAlign: -2, marginRight: 6, color: cert && !cert.bloqueios.length ? 'var(--ok)' : 'var(--danger)' }} />
        {cert
          ? <>Certificado: <b>{cert.titular}</b> · válido até {dataBR(cert.valido_ate)} ({cert.dias_restantes} dias)</>
          : <span style={{ color: 'var(--danger)' }}>Sem certificado A1 cadastrado</span>}
        {cert && [...cert.bloqueios, ...cert.alertas].map((m) => <div key={m} style={{ color: cert.bloqueios.includes(m) ? 'var(--danger)' : 'var(--warn)' }}>{m}</div>)}
      </div>

      {aberto && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 14 }}>
          <div>
            <div className="form-field">
              <label className="form-label">XML de uma NFS-e já emitida (gabarito){status.configurada ? ' — só se quiser trocar' : ''}</label>
              <input type="file" accept=".xml" onChange={(e) => setGabarito(e.target.files[0] || null)} />
              <div style={suave}>Baixe no portal da NFS-e uma nota desta empresa. Dela vêm regime, código do serviço e tributação.</div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Série da DPS</label>
                <input value={form.serie_dps} onChange={(e) => setForm({ ...form, serie_dps: e.target.value })} />
              </div>
              <div className="form-field">
                <label className="form-label">Ambiente</label>
                <select value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })}>
                  <option value="homologacao">Homologação (testes)</option>
                  <option value="producao">Produção (nota real)</option>
                </select>
              </div>
            </div>
            {optanteSimples && (
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">IBS/CBS no Simples (regApIBSCBSSN)</label>
                  <select value={simples.regApIBSCBSSN} onChange={(e) => setSimples({ ...simples, regApIBSCBSSN: e.target.value })}>
                    <option value="">— escolher —</option>
                    <option value="1">1 - IBS e CBS apurados pelo SN</option>
                    <option value="2">2 - CBS pelo SN e IBS pelo regime regular</option>
                    <option value="3">3 - IBS e CBS pelo regime regular</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Atividade no Simples (cAtvSN)</label>
                  <select value={simples.cAtvSN} onChange={(e) => setSimples({ ...simples, cAtvSN: e.target.value })}>
                    <option value="">— escolher —</option>
                    <option value="7">7 - Serviços exclusivamente do Anexo III</option>
                    <option value="8">8 - Serviços contábeis com ISS fixo (Anexo III)</option>
                    <option value="9">9 - Sujeitos ao Fator R (Anexo III ou V)</option>
                    <option value="10">10 - Transporte municipal de passageiros (Anexo III)</option>
                    <option value="11">11 - Locação de bens móveis e outras sem ISS (Anexo III)</option>
                    <option value="12">12 - Construção civil 7.02/7.05 (Anexo III)</option>
                    <option value="13">13 - Construção civil 7.02/7.05 (Anexo IV)</option>
                    <option value="14">14 - Serviços do Anexo IV</option>
                    <option value="90">90 - Operações não tributadas</option>
                  </select>
                </div>
              </div>
            )}
            <div style={{ ...suave, margin: '4px 0 6px' }}>IBS/CBS (Reforma Tributária) — tabelas no portal da NFS-e, Anexos VII e VIII</div>
            <div className="form-row">
              {[['cNBS', 'NBS do serviço', '123012300'], ['cIndOp', 'Indicador da operação (cIndOp)', '030101'],
                ['CST', 'CST', '200'], ['cClassTrib', 'cClassTrib', '200029']].map(([campo, rotulo, exemplo]) => (
                <div className="form-field" key={campo}>
                  <label className="form-label">{rotulo}</label>
                  <input value={simples[campo]} placeholder={`ex.: ${exemplo}`} onChange={(e) => setSimples({ ...simples, [campo]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="form-field">
              <label className="form-label">Competência padrão</label>
              <select value={form.regra_competencia} onChange={(e) => setForm({ ...form, regra_competencia: e.target.value })}>
                <option value="mes_do_atendimento">Data do atendimento</option>
                <option value="mes_da_emissao">Data da emissão</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Descrição padrão do serviço</label>
              <input value={form.descricao_padrao} placeholder="ex.: Sessão de psicoterapia"
                onChange={(e) => setForm({ ...form, descricao_padrao: e.target.value })} />
              <div style={suave}>Usada quando nem a mensagem nem o cadastro do cliente trazem a descrição.</div>
            </div>
            <button className="btn btn-accent" disabled={salvando} onClick={salvarEmpresa}>Salvar configuração</button>
          </div>
          <div>
            <div className="form-field">
              <label className="form-label">Certificado A1 (.pfx)</label>
              <input type="file" accept=".pfx,.p12" onChange={(e) => setPfx(e.target.files[0] || null)} disabled={!status.configurada} />
            </div>
            <div className="form-field">
              <label className="form-label">Senha do certificado</label>
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} disabled={!status.configurada} />
            </div>
            <div style={{ ...suave, marginBottom: 10 }}>O arquivo e a senha são cifrados no servidor e nunca voltam para o navegador.</div>
            <button className="btn btn-accent" disabled={salvando || !status.configurada} onClick={salvarCertificado}>Salvar certificado</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- página

export default function NfseEmissaoPage() {
  const { show } = useToast()
  const clientes = useStore((s) => s.clientes)
  const empresas = useMemo(() => [...clientes].filter((c) => c.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes])
  const [clienteId, setClienteId] = useState(() => localStorage.getItem('nfse-cliente') || '')
  const [status, setStatus] = useState(null)
  const [lotes, setLotes] = useState([])
  const [loteId, setLoteId] = useState('')
  const [notas, setNotas] = useState([])
  const [selecionadas, setSelecionadas] = useState(() => new Set())
  const [texto, setTexto] = useState('')
  const [compMassa, setCompMassa] = useState('')
  const [filtro, setFiltro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [previa, setPrevia] = useState(null)

  const ambiente = status?.empresa?.ambiente
  const podeEmitir = status?.configurada && status.certificado && !status.certificado.bloqueios.length

  async function carregarStatus(id = clienteId) {
    if (!id) return
    try { setStatus(await chamarNfse('status', { cliente_id: id })) } catch (e) { show(e.message) }
  }

  async function carregarLotes(selecionar) {
    if (!clienteId || !ambiente) { setLotes([]); return }
    const l = await listarLotes(clienteId, ambiente)
    setLotes(l)
    const alvo = selecionar || (l.some((x) => x.id === loteId) ? loteId : l[0]?.id || '')
    setLoteId(alvo)
  }

  async function carregarNotas(id = loteId) {
    if (!id) { setNotas([]); return }
    const n = await listarNotas(id)
    setNotas(n)
    // Seleção vale para notas ainda editáveis (competência em massa); a emissão usa só as prontas
    setSelecionadas((s) => new Set([...s].filter((x) => n.some((y) => y.id === x && EDITAVEL(y)))))
  }

  useEffect(() => {
    localStorage.setItem('nfse-cliente', clienteId)
    setStatus(null); setLotes([]); setLoteId(''); setNotas([]); setSelecionadas(new Set())
    carregarStatus(clienteId)
  }, [clienteId])
  useEffect(() => { carregarLotes().catch((e) => show(e.message)) }, [clienteId, ambiente])
  useEffect(() => { carregarNotas().catch((e) => show(e.message)) }, [loteId])

  async function acao(fn, msgOk) {
    setOcupado(true)
    try {
      const r = await fn()
      if (msgOk) show(msgOk)
      return r
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  async function importarTexto() {
    const r = await acao(() => chamarNfse('importar', { cliente_id: clienteId, texto }), 'Mensagens importadas')
    if (r) { setTexto(''); await carregarLotes(r.lote_id) }
  }

  async function importarPlanilha(arquivo) {
    if (!arquivo) return
    const r = await acao(async () => chamarNfse('importar', { cliente_id: clienteId, planilha_base64: await arquivoParaBase64(arquivo), nome_arquivo: arquivo.name }), 'Planilha importada')
    if (r) await carregarLotes(r.lote_id)
  }

  async function editar(nota, campo, valor) {
    const atual = { cpf: cpfFmt(nota.cpf), data: dataBR(nota.data), competencia: dataBR(nota.competencia), valor: valorBR(nota.valor) }[campo] ?? (nota[campo] || '')
    if (valor === atual) return
    await acao(() => chamarNfse('editar', { nota_id: nota.id, campos: { [campo]: valor } }))
    await carregarNotas()
  }

  async function aplicarCompetencia(valor) {
    if (!selecionadas.size) { show('Selecione as notas (caixinha à esquerda) antes'); return }
    await acao(() => chamarNfse('competencia', { nota_ids: [...selecionadas], competencia: valor }),
      valor ? `Competência ${valor} aplicada` : 'Competência padrão restaurada')
    await carregarNotas()
  }

  async function emitirSelecionadas() {
    setConfirmar(false)
    const fila = alvoEmissao.map((n) => n.id)
    const conta = { autorizada: 0, rejeitada: 0, indeterminada: 0, pulada: 0 }
    setOcupado(true)
    try {
      for (const [i, id] of fila.entries()) {
        setProgresso(`Emitindo ${i + 1} de ${fila.length}…`)
        try {
          let r
          try {
            r = await chamarNfse('emitir', { nota_id: id, ambiente })
          } catch (e) {
            // Nota parecida com outra já emitida: só segue se o usuário confirmar, nota por nota
            if (!e.message.startsWith('Possível nota repetida')) throw e
            if (!window.confirm(`${e.message}\n\nEmitir mesmo assim? (Cancelar = pular esta nota)`)) { conta.pulada++; continue }
            r = await chamarNfse('emitir', { nota_id: id, ambiente, confirmar_repetida: true })
          }
          conta[r.resultado.estado] = (conta[r.resultado.estado] || 0) + 1
        } catch (e) {
          show(`Emissão interrompida: ${e.message}`)
          break
        }
        await carregarNotas()
        await new Promise((ok) => setTimeout(ok, 1500)) // uma nota por vez, com intervalo
      }
    } finally {
      setOcupado(false)
      setProgresso(`Concluído: ${conta.autorizada} autorizada(s), ${conta.rejeitada} rejeitada(s), ${conta.indeterminada} indeterminada(s)${conta.pulada ? `, ${conta.pulada} pulada(s) por parecer repetida` : ''}`)
      setSelecionadas(new Set())
      await carregarNotas()
    }
  }

  async function marcarCancelada(nota) {
    const motivo = window.prompt(`NFS-e nº ${nota.numero_nfse || '?'} — ${nota.nome || ''}\n\nEla já foi cancelada no portal nacional? Informe o motivo para registrar aqui (some do painel do cliente e dos totais):`, 'Nota emitida em duplicidade')
    if (!motivo || !motivo.trim()) return
    await acao(() => chamarNfse('marcar_cancelada', { nota_id: nota.id, motivo }), 'Nota marcada como cancelada')
    await carregarNotas()
  }

  async function reconsultar(nota) {
    await acao(() => chamarNfse('emitir', { nota_id: nota.id, ambiente }))
    await carregarNotas()
  }

  // Decisões da trava "Complementar?" / "Já emitida"
  async function decidir(nota, nomeAcao, extra, msgOk) {
    await acao(() => chamarNfse(nomeAcao, { nota_id: nota.id, ...extra }), msgOk)
    await carregarNotas()
  }

  async function verPrevia(nota) {
    const r = await acao(() => chamarNfse('previa', { nota_id: nota.id }))
    if (r) setPrevia(r)
  }

  const t = totais(notas)
  const abaAtual = ABAS.find(([id]) => id === filtro) || ABAS[0]
  const visiveis = notas.filter(abaAtual[2])
  const prontas = notas.filter((n) => n.estado === 'validada')
  const editaveis = notas.filter(EDITAVEL)
  const marcadas = notas.filter((n) => selecionadas.has(n.id)) // para competência em massa
  const sel = marcadas.filter((n) => n.estado === 'validada') // o que de fato pode ser emitido
  const totalSel = sel.reduce((s, n) => s + Number(n.valor || 0), 0)
  const conta = (f) => notas.filter(f).length
  // Sem nada marcado, "Emitir" manda todas as prontas
  const alvoEmissao = sel.length ? sel : prontas
  const totalAlvo = alvoEmissao.reduce((s, n) => s + Number(n.valor || 0), 0)
  const competencias = Object.entries(alvoEmissao.reduce((m, n) => {
    const c = n.competencia ? dataBR(n.competencia) : status?.empresa?.regra_competencia === 'mes_da_emissao' ? dataBR(hoje()) : dataBR(n.data)
    m[c] = (m[c] || 0) + 1
    return m
  }, {})).map(([c, q]) => `${c} (${q})`).join(', ')

  // Campo que falta fica com borda tracejada e "preencher", para completar ali mesmo
  const inp = (n, campo, valor, largura, extra = {}) => {
    const falta = EDITAVEL(n) && n.pendencias.includes(PENDENCIA[campo])
    return (
      <input key={`${n.id}-${campo}-${valor}`} defaultValue={valor} disabled={!EDITAVEL(n) || ocupado}
        onBlur={(e) => editar(n, campo, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        placeholder={falta ? 'preencher' : undefined} title={falta ? `Falta ${PENDENCIA[campo]}` : undefined}
        onFocus={(e) => { e.target.style.borderColor = 'var(--accent)' }} {...extra}
        style={{ minWidth: largura, padding: '4px 6px', fontSize: 12, background: falta ? 'var(--surface)' : 'transparent',
          border: falta ? '1px dashed var(--warn)' : '1px solid transparent', ...(extra.style || {}) }} />
    )
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSignatureIcon size={18} /> Emitir NFS-e
          </h2>
          <p style={suave}>Escolha a empresa, importe os atendimentos e confira antes de emitir. A nota sai pela Sefin Nacional com o certificado A1 da empresa.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <EmpresaCombobox empresas={empresas} value={clienteId} onChange={setClienteId} placeholder="Escolher empresa..." style={{ flex: 1, minWidth: 260 }} />
        {ambiente && <AmbienteBadge ambiente={ambiente} />}
        {status?.configurada && (
          <button className="btn" title="Link para o cliente ver e baixar todas as notas emitidas (Sistema Nacional), com PDF, XML e WhatsApp"
            onClick={async () => {
              try {
                const url = urlPublica({ notas: await chavePainelPorId(clienteId) })
                await navigator.clipboard.writeText(url)
                show('Link de todas as notas copiado')
              } catch (e) { show(`Não foi possível copiar o link: ${e.message}`) }
            }}>
            <CopyIcon size={14} /> Link: todas as notas
          </button>
        )}
      </div>

      {!clienteId && <div style={{ ...card, ...suave }}>Escolha a empresa para configurar ou emitir.</div>}
      {clienteId && status && <Configuracao clienteId={clienteId} status={status} onAtualizado={setStatus} />}
      {clienteId && <TomadoresPanel clienteId={clienteId} />}

      {status?.configurada && (
        <div style={card}>
          <h3 style={titulo}><UploadIcon size={16} /> 1. Importar atendimentos</h3>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5}
            placeholder={'Cole aqui as mensagens do WhatsApp…\n\n[10:03, 13/10/2026] Fulana: Nome do Paciente\n123.456.789-09\nRua Tal 150\n22/01/26\nValor: 900,00\nDescrição do serviço'}
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-accent" disabled={ocupado || !texto.trim()} onClick={importarTexto}>Ler mensagens</button>
            <span style={suave}>ou envie uma planilha (colunas: data, nome, cpf, endereco, cep, descricao, valor):</span>
            <input type="file" accept=".xlsx,.xls,.csv" style={{ width: 'auto' }} disabled={ocupado}
              onChange={(e) => { importarPlanilha(e.target.files[0]); e.target.value = '' }} />
          </div>
        </div>
      )}

      {status?.configurada && lotes.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <h3 style={{ ...titulo, margin: 0 }}><SendIcon size={16} /> 2. Conferir e emitir</h3>
            <select value={loteId} onChange={(e) => setLoteId(e.target.value)} style={{ width: 'auto', minWidth: 260, marginLeft: 'auto' }} title="Lote (cada importação vira um lote)">
              {lotes.map((l) => <option key={l.id} value={l.id}>Lote de {new Date(l.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {l.origem}{l.descricao ? ` · ${l.descricao}` : ''}</option>)}
            </select>
            <button className="btn btn-icon btn-ghost" title="Atualizar" onClick={() => carregarNotas()}><RefreshCwIcon size={16} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[['Total do lote', brl(t.servico), 'var(--text1)'], ['Já emitido', brl(t.emitido), 'var(--ok)'], ['Falta emitir', brl(t.faltando), 'var(--warn)']].map(([r, v, cor]) => (
              <div key={r} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={suave}>{r}</div><div style={{ fontSize: 18, fontWeight: 800, color: cor }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Abas: o que fazer com cada nota */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {ABAS.map(([id, rotulo, f]) => {
              const q = conta(f)
              if (id && !q) return null
              const ativa = filtro === id
              const alerta = ['decidir', 'pendente', 'invalido', 'problema'].includes(id)
              return (
                <button key={id || 'todas'} type="button" onClick={() => setFiltro(id)}
                  style={{ fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '5px 12px', cursor: 'pointer',
                    border: `1px solid ${ativa ? 'var(--accent)' : alerta ? 'var(--warn)' : 'var(--border)'}`,
                    background: ativa ? 'var(--accent)' : 'transparent', color: ativa ? '#fff' : alerta ? 'var(--warn)' : 'var(--text2)' }}>
                  {rotulo} <span style={{ opacity: 0.8 }}>{q}</span>
                </button>
              )
            })}
          </div>
          {DICA_ABA[filtro] && <div style={{ ...suave, marginBottom: 10 }}>{DICA_ABA[filtro]}</div>}

          {/* Barra de emissão */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
            <button className="btn btn-accent" disabled={ocupado || !alvoEmissao.length || !podeEmitir}
              title={podeEmitir ? '' : 'Configure o certificado A1 antes'} onClick={() => setConfirmar(true)}
              style={{ fontSize: 13, padding: '8px 16px' }}>
              <SendIcon size={14} /> {sel.length ? `Emitir ${sel.length} marcada${sel.length === 1 ? '' : 's'}` : `Emitir ${prontas.length} pronta${prontas.length === 1 ? '' : 's'}`} · {brl(totalAlvo)}
            </button>
            <span style={suave}>{sel.length ? 'Só as marcadas que estão prontas.' : 'Marque na caixinha para emitir só algumas.'}</span>
            {marcadas.length > 0 && <button className="btn btn-ghost" onClick={() => setSelecionadas(new Set())}>Desmarcar ({marcadas.length})</button>}
            <span style={{ fontWeight: 600, fontSize: 12, marginLeft: 'auto' }}>{progresso}</span>
          </div>

          <details style={{ marginBottom: 10 }}>
            <summary style={{ ...suave, cursor: 'pointer' }}>Mudar a competência das notas marcadas</summary>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <input value={compMassa} onChange={(e) => setCompMassa(e.target.value)} placeholder="mm/aaaa ou dd/mm/aaaa" style={{ width: 160 }} />
              <button className="btn" disabled={ocupado} onClick={() => aplicarCompetencia(compMassa.trim())}>Aplicar nas marcadas</button>
              <button className="btn" disabled={ocupado} onClick={() => aplicarCompetencia('')}>Voltar ao padrão</button>
              <span style={suave}>Padrão: {status.empresa.regra_competencia === 'mes_da_emissao' ? 'data da emissão' : 'data do atendimento'}</span>
            </div>
          </details>

          <div className="tabela-rolagem">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                  <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" style={{ width: 'auto' }} title="Marcar todas as visíveis ainda não emitidas"
                      checked={visiveis.some(EDITAVEL) && visiveis.filter(EDITAVEL).every((n) => selecionadas.has(n.id))}
                      onChange={(e) => setSelecionadas((s) => { const x = new Set(s); visiveis.filter(EDITAVEL).forEach((n) => (e.target.checked ? x.add(n.id) : x.delete(n.id))); return x })} />
                  </th>
                  {['Situação', 'Paciente', 'CPF', 'Atendimento', 'Competência', 'Valor', 'Descrição', 'Endereço', 'O que fazer / resultado', ''].map((h, i) => (
                    <th key={i} style={{ padding: '6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && <tr><td colSpan={11} style={{ padding: 16, ...suave, textAlign: 'center' }}>Nenhuma nota nesta aba.</td></tr>}
                {visiveis.map((n) => {
                  const tipo = situacao(n)
                  const fundo = { pendente: 'var(--warn-dim)', invalido: 'var(--danger-dim)', rejeitada: 'var(--danger-dim)', indeterminada: 'var(--warn-dim)', complementar: 'var(--info-dim)' }[tipo]
                  const padraoComp = status.empresa.regra_competencia === 'mes_da_emissao' ? 'data da emissão' : dataBR(n.data)
                  const dif = tipo === 'complementar' ? diferencaDe(n) : null
                  const outrosErros = n.erros.filter((e) => !e.startsWith(JA_EMITIDA) && !e.startsWith(COMPLEMENTAR))
                  return (
                    <tr key={n.id} style={{ background: fundo, borderBottom: '1px solid var(--border)', verticalAlign: 'top', opacity: n.ciente_em ? 0.6 : 1 }}>
                      <td style={{ padding: 6 }}><input type="checkbox" style={{ width: 'auto' }} disabled={!EDITAVEL(n)} checked={selecionadas.has(n.id)}
                        onChange={(e) => setSelecionadas((s) => { const x = new Set(s); e.target.checked ? x.add(n.id) : x.delete(n.id); return x })} /></td>
                      <td style={{ padding: 6 }}><Pill tipo={tipo}>{ROTULO[tipo] || tipo.replace('_', ' ')}</Pill></td>
                      <td style={{ padding: 2 }}>{inp(n, 'nome', n.nome, 180)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'cpf', cpfFmt(n.cpf), 120)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'data', dataBR(n.data), 90)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'competencia', dataBR(n.competencia), 90, { placeholder: padraoComp, title: `Vazio = ${padraoComp}. Aceita dd/mm/aaaa ou mm/aaaa` })}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'valor', valorBR(n.valor), 80, { style: { minWidth: 80, padding: '4px 6px', fontSize: 12, textAlign: 'right', background: 'transparent', border: '1px solid transparent' } })}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'descricao', n.descricao, 180)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'endereco', n.endereco, 180)}</td>
                      <td style={{ padding: 6, minWidth: 240, maxWidth: 360 }}>
                        {n.estado === 'autorizada' && <>
                          <div style={{ color: 'var(--ok)', fontWeight: 700 }}>✔ NFS-e nº {n.numero_nfse || '?'}</div>
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarNfse(clienteId, { id: n.id, numero: n.numero_nfse, chave: n.chave_acesso }, 'pdf', { incluirHomologacao: true }).catch((x) => show(x.message)) }}
                            title="DANFSe (NT 008/2026) gerado a partir do XML autorizado">PDF</a>{' · '}
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarXml(n.id, 'xml_retorno').catch((x) => show(x.message)) }}>XML</a>{' · '}
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarXml(n.id, 'xml_enviado').catch((x) => show(x.message)) }} title="DPS assinada enviada à Sefin">DPS</a>{' · '}
                          <a href="#" style={{ color: 'var(--danger)' }} onClick={(e) => { e.preventDefault(); if (!ocupado) marcarCancelada(n) }}
                            title="Use depois de cancelar a nota no portal nacional (www.nfse.gov.br)">Cancelada no portal</a>
                          <div style={{ ...suave, fontSize: 10.5, wordBreak: 'break-all' }}>{n.chave_acesso}</div>
                        </>}
                        {n.estado === 'cancelada' && <>
                          <div style={{ color: 'var(--text3)', textDecoration: 'line-through' }}>NFS-e nº {n.numero_nfse || '?'}</div>
                          <div style={suave}>{n.mensagem_sefin || 'Cancelada no portal nacional'}</div>
                        </>}
                        {n.estado === 'rejeitada' && <>
                          <div style={{ color: 'var(--danger)' }}>✖ {n.mensagem_sefin}</div>
                          {n.copiada_para ? <div style={suave}>Refeita em outra nota (fora dos totais)</div>
                            : <button className="btn" style={{ marginTop: 4 }} disabled={ocupado}
                              onClick={async () => { await acao(() => chamarNfse('copiar', { nota_id: n.id }), 'Cópia criada para corrigir'); await carregarNotas() }}>
                              <CopyIcon size={12} /> Copiar para corrigir</button>}
                        </>}
                        {(n.estado === 'indeterminada' || n.estado === 'enviada') && <>
                          <div style={{ color: 'var(--warn)' }}>? {n.mensagem_sefin || 'Envio sem resposta'}</div>
                          <button className="btn" style={{ marginTop: 4 }} disabled={ocupado} onClick={() => reconsultar(n)}>Reconsultar (e reenviar se não existir)</button>
                        </>}
                        {n.estado === 'numero_reservado' && <div style={suave}>DPS nº {n.n_dps} reservada, ainda não enviada.</div>}

                        {EDITAVEL(n) && tipo === 'pronto' && <div style={{ color: 'var(--ok)', fontWeight: 600 }}>Pronta para emitir</div>}

                        {EDITAVEL(n) && tipo === 'complementar' && <>
                          <div style={{ color: 'var(--info)', fontWeight: 700 }}>Paciente já tem nota parecida</div>
                          <div style={{ color: 'var(--text2)' }}>{anteriorDe(n, COMPLEMENTAR)}</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            {dif && <button className="btn btn-accent" disabled={ocupado} onClick={() => decidir(n, 'complementar', {}, `Nota ajustada para a diferença (${dif})`)}
                              title="A nota vira a complementar: valor da diferença e descrição começando com Complementar">Emitir só a diferença ({dif})</button>}
                            <button className="btn" disabled={ocupado} onClick={() => decidir(n, 'liberar_duplicidade', {}, 'Liberada: sai pelo valor cheio')}
                              title="É outro serviço para o mesmo paciente">Emitir valor cheio ({brl(n.valor)})</button>
                          </div>
                        </>}

                        {EDITAVEL(n) && tipo === 'ja_emitida' && <>
                          <div style={{ color: 'var(--text2)', fontWeight: 700 }}>Já foi emitida</div>
                          <div style={{ color: 'var(--text2)' }}>{anteriorDe(n, JA_EMITIDA)}</div>
                          {n.ciente_em && <div style={{ color: 'var(--ok)', fontWeight: 600 }}>✔ Cliente ciente em {dataBR(n.ciente_em)}</div>}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            <button className="btn" disabled={ocupado}
                              onClick={async () => { await acao(() => chamarNfse('excluir', { nota_id: n.id }), 'Removida do lote'); await carregarNotas() }}>Remover do lote</button>
                            {n.erros.some((e) => e.startsWith(JA_EMITIDA) && /fora do gestor/.test(e)) && (
                              <button className="btn" disabled={ocupado} onClick={() => decidir(n, 'liberar_duplicidade', {}, 'Liberada: sai pelo valor cheio')}
                                title="É outro atendimento, com o mesmo valor">É outro atendimento — emitir</button>
                            )}
                          </div>
                        </>}

                        {EDITAVEL(n) && n.duplicidade_liberada && (
                          <div style={{ ...suave, marginTop: 4 }}>
                            ✔ Conferido: sai pelo valor cheio · <a href="#" onClick={(e) => { e.preventDefault(); if (!ocupado) decidir(n, 'liberar_duplicidade', { liberar: false }, 'Trava de nota parecida reativada') }}>desfazer</a>
                          </div>
                        )}

                        {EDITAVEL(n) && <>
                          {outrosErros.map((e) => <div key={e} style={{ color: 'var(--danger)' }}>✖ {e}</div>)}
                          {n.pendencias.length > 0 && <div style={{ color: 'var(--warn)', fontWeight: 600 }}>Falta: {n.pendencias.join(', ')}</div>}
                          {n.avisos.map((a) => <div key={a} style={suave}>• {a}</div>)}
                        </>}
                        {n.observacao_cliente && <div style={{ color: 'var(--info)', whiteSpace: 'pre-wrap' }}>💬 Cliente: {n.observacao_cliente}</div>}
                        {n.n_dps && <div style={suave}>DPS série {n.serie} nº {n.n_dps}</div>}
                        {n.texto_original && <details><summary style={{ ...suave, cursor: 'pointer' }}>mensagem original{n.autor ? ` de ${n.autor}` : ''}</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0 0', maxWidth: 320 }}>{n.texto_original}</pre></details>}
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {n.estado === 'validada' && <button className="btn btn-icon btn-ghost" title="Ver a DPS assinada que seria enviada" onClick={() => verPrevia(n)}><FileCodeIcon size={15} /></button>}
                        {EDITAVEL(n) && <button className="btn btn-icon btn-ghost" title="Remover do lote" disabled={ocupado}
                          onClick={async () => { if (window.confirm('Remover este registro do lote?')) { await acao(() => chamarNfse('excluir', { nota_id: n.id })); await carregarNotas() } }}>
                          <Trash2Icon size={15} /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmar && (
        <Modal onClose={() => setConfirmar(false)}>
          <div className="modal-title">Confirmar emissão</div>
          <div style={{ textAlign: 'center', margin: '12px 0' }}><AmbienteBadge ambiente={ambiente} grande /></div>
          {ambiente === 'producao' && <p style={{ color: 'var(--danger)', fontWeight: 600, textAlign: 'center' }}>Notas fiscais reais.</p>}
          <p><b>{alvoEmissao.length}</b> nota(s), total <b>{brl(totalAlvo)}</b>.</p>
          <p>Competência: <b>{competencias}</b></p>
          <p style={suave}>{empresas.find((e) => e.id === clienteId)?.nome} · série DPS {status.empresa.serie_dps}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setConfirmar(false)}>Cancelar</button>
            <button className="btn btn-accent" onClick={emitirSelecionadas}>Emitir</button>
          </div>
        </Modal>
      )}

      {previa && (
        <Modal onClose={() => setPrevia(null)}>
          <div className="modal-title">Prévia da DPS — nº {previa.numero_previa} (não reservado)</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, maxHeight: '60vh', overflow: 'auto', background: 'var(--surface2)', padding: 10, borderRadius: 6 }}>
            {previa.xml.replace(/></g, '>\n<')}
          </pre>
          <div style={{ textAlign: 'right', marginTop: 10 }}><button className="btn" onClick={() => setPrevia(null)}>Fechar</button></div>
        </Modal>
      )}
    </div>
  )
}
