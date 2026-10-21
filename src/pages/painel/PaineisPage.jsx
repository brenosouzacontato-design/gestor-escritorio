import { useState, useMemo, useEffect } from 'react'
import { Share2Icon, MonitorIcon, RefreshCwIcon, Building2Icon, BriefcaseIcon, BarChart3Icon } from 'lucide-react'
import { useStore } from '../../store'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import PainelClientePage from './PainelClientePage'
import PainelCompartilhadoPage from './PainelCompartilhadoPage'
import { chavePainel, urlPublica, girarTokenPainel } from '../../lib/linksPublicos'
import CompartilharGrupoModal from './CompartilharGrupoModal'
import CarteirasPainel from './CarteirasPainel'
import RelatorioAcessosPainel from './RelatorioAcessosPainel'

const CHAVE_ULTIMO_CLIENTE = 'paineis-cliente-selecionado'
const CHAVE_ABA = 'paineis-aba'
const ABAS = [
  { id: 'empresa', label: 'Por empresa', Icone: MonitorIcon },
  { id: 'carteira', label: 'Por carteira', Icone: BriefcaseIcon },
  { id: 'relatorio', label: 'Relatório de acessos', Icone: BarChart3Icon },
]
const DESCRICAO_ABA = {
  empresa: 'Escolha a empresa pra ver e compartilhar o painel',
  carteira: 'As empresas de cada carteira, com o link da carteira pra quem cuida dela',
  relatorio: 'Quem abriu o painel, quantas vezes, o que baixou e de qual aparelho',
}

// Módulo dedicado a ver e compartilhar o painel dos clientes — abre direto
// no painel (sem passar por uma listagem antes), trocando de empresa pela
// combobox com busca no topo. Antes só dava pra abrir o painel de dentro
// do modal de uma empresa em Empresas.jsx; aqui é o ponto de entrada direto.
export default function PaineisPage() {
  const clientes = useStore(s => s.clientes)
  const compSel = useStore(s => s.competenciaSelecionada)
  const [clienteId, setClienteId] = useState(() => localStorage.getItem(CHAVE_ULTIMO_CLIENTE) || '')
  // 'nova' = PainelCompartilhadoPage (padrão do link); 'completa' = painel antigo (&versao=1)
  const [versao, setVersao] = useState('nova')
  const [grupoAberto, setGrupoAberto] = useState(false)
  const [aba, setAba] = useState(() => {
    try { return ABAS.some(a => a.id === localStorage.getItem(CHAVE_ABA)) ? localStorage.getItem(CHAVE_ABA) : 'empresa' } catch { return 'empresa' }
  })
  const escolherAba = (id) => {
    setAba(id)
    try { localStorage.setItem(CHAVE_ABA, id) } catch { /* sem localStorage */ }
  }

  const clientesOrdenados = useMemo(() => [...clientes].sort((a, b) => a.nome.localeCompare(b.nome)), [clientes])

  // Cai no primeiro cliente da lista se ainda não tem nenhum escolhido, ou
  // se o que estava salvo não existe mais (inativado/excluído).
  useEffect(() => {
    if (clientesOrdenados.length === 0) return
    if (!clientesOrdenados.some(c => c.id === clienteId)) {
      setClienteId(clientesOrdenados[0].id)
    }
  }, [clientesOrdenados, clienteId])

  useEffect(() => {
    if (clienteId) localStorage.setItem(CHAVE_ULTIMO_CLIENTE, clienteId)
  }, [clienteId])

  const clienteAtual = clientesOrdenados.find(c => c.id === clienteId)

  const compartilhar = () => {
    if (!clienteAtual) return
    const link = urlPublica({ painel: chavePainel(clienteAtual), competencia: compSel, versao: versao === 'completa' ? 1 : null })
    const mensagem = versao === 'completa'
      ? `Olá! Segue o painel de ${clienteAtual.nome} — competência ${compSel} — com obrigações, financeiro e demais informações:\n${link}`
      : `Olá! Seguem os impostos e as pendências fiscais de ${clienteAtual.nome} — competência ${compSel}:\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  // Link vazou ou foi parar com quem não devia: troca o token do painel do
  // cliente. Todos os links já enviados (painel, DRE/balancete, notas,
  // identificação de lançamentos) param de funcionar — ver docs/seguranca-rls.md.
  const [gerandoLink, setGerandoLink] = useState(false)
  const gerarNovoLink = async () => {
    if (!clienteAtual) return
    if (!window.confirm(`Gerar um link novo pro painel de ${clienteAtual.nome}? Todos os links já enviados pra esse cliente param de funcionar.`)) return
    setGerandoLink(true)
    try {
      const token = await girarTokenPainel(clienteAtual.id)
      useStore.setState(s => ({ clientes: s.clientes.map(c => c.id === clienteAtual.id ? { ...c, painel_token: token } : c) }))
      window.alert('Link novo gerado. Use "Compartilhar" pra mandar ao cliente.')
    } catch (e) {
      window.alert('Não consegui gerar o link novo: ' + e.message)
    }
    setGerandoLink(false)
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorIcon size={18} /> Painéis
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {DESCRICAO_ABA[aba]}{aba !== 'relatorio' ? ` — competência ${compSel}` : ''}.
          </p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {ABAS.map(({ id, label, Icone }) => (
          <button key={id} className={`tab-btn ${aba === id ? 'active' : ''}`} onClick={() => escolherAba(id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icone size={13} /> {label}
          </button>
        ))}
      </div>

      {aba === 'carteira' && (
        <CarteirasPainel clientes={clientesOrdenados} competencia={compSel} versao={versao}
          onVerPainel={(id) => { setClienteId(id); escolherAba('empresa') }} />
      )}

      {aba === 'relatorio' && <RelatorioAcessosPainel clientes={clientesOrdenados} />}

      {aba === 'empresa' && <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <EmpresaCombobox empresas={clientesOrdenados} value={clienteId} onChange={setClienteId}
          placeholder="Escolher empresa..." style={{ flex: 1, minWidth: 240 }} />
        <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
          {[['nova', 'Nova versão'], ['completa', 'Completo']].map(([v, label]) => (
            <button key={v} onClick={() => setVersao(v)}
              style={{ border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: versao === v ? 'var(--navy)' : 'transparent', color: versao === v ? '#fff' : 'var(--text2)' }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={compartilhar} disabled={!clienteAtual} className="btn btn-accent" style={{ padding: '7px 14px' }}>
          <Share2Icon size={13} /> Compartilhar
        </button>
        <button onClick={() => setGrupoAberto(true)} disabled={!clienteAtual} className="btn" style={{ padding: '7px 14px' }}
          title="Um link só com várias empresas do mesmo cliente — ele escolhe qual ver no topo do painel">
          <Building2Icon size={13} /> Grupo de empresas
        </button>
        <button onClick={gerarNovoLink} disabled={!clienteAtual || gerandoLink} className="btn btn-ghost" style={{ padding: '7px 14px' }}
          title="Troca o link do cliente: os links já enviados param de funcionar">
          <RefreshCwIcon size={13} /> {gerandoLink ? 'Gerando...' : 'Gerar novo link'}
        </button>
      </div>

      {grupoAberto && (
        <CompartilharGrupoModal clientes={clientesOrdenados} clienteInicialId={clienteAtual?.id}
          competencia={compSel} versao={versao} onClose={() => setGrupoAberto(false)} />
      )}

      {!clienteAtual && (
        <div className="empty">
          <p>🖥️</p>
          Nenhuma empresa cadastrada.
        </div>
      )}

      {clienteAtual && (versao === 'nova'
        ? <PainelCompartilhadoPage key={`${clienteAtual.id}-${compSel}`} clienteId={clienteAtual.id} competencia={compSel} admin />
        : <PainelClientePage key={clienteAtual.id} clienteId={clienteAtual.id} competencia={compSel} admin />)}
      </>}
    </div>
  )
}
