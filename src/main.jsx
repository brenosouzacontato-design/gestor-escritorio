import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ComLogin from './components/ComLogin.jsx'
import RelatorioCompartilhadoPage from './pages/contabil/RelatorioCompartilhadoPage.jsx'
import NotasFiscaisCompartilhadoPage from './pages/contabil/NotasFiscaisCompartilhadoPage.jsx'
import IdentificarLancamentosPage from './pages/contabil/IdentificarLancamentosPage.jsx'
import DocumentoCompartilhadoPage from './pages/documentos/DocumentoCompartilhadoPage.jsx'
import PainelClientePage from './pages/painel/PainelClientePage.jsx'
import PainelCompartilhadoPage from './pages/painel/PainelCompartilhadoPage.jsx'
import ComprovanteFaturamentoPage from './pages/painel/ComprovanteFaturamentoPage.jsx'
import PainelGrupoPage from './pages/painel/PainelGrupoPage.jsx'
import PainelCarteiraPage from './pages/painel/PainelCarteiraPage.jsx'
import NotasEmitidasPage from './pages/painel/NotasEmitidasPage.jsx'
import PedidoNfePage from './pages/pedidonfe/PedidoNfePage.jsx'
import FichaAdmissaoPage from './pages/admissao/FichaAdmissaoPage.jsx'
import { registrarVisualizacaoPainel, avisarEventoPainel } from './pages/painel/painelApi.js'
import './styles.css'

// Links compartilhados (Balancete/DRE e identificação de lançamentos via
// WhatsApp) — renderizam só a página pública correspondente, sem montar o
// app inteiro (evita disparar o carregamento pesado da store à toa numa
// página que é só leitura/preenchimento simples).
const params = new URLSearchParams(window.location.search)
const share = params.get('share')
const identificar = params.get('identificar')
const doc = params.get('doc')
const painel = params.get('painel')
const carteira = params.get('carteira')
const notas = params.get('notas')
const pedido = params.get('pedido')
const admissao = params.get('admissao')

// O gestor exige login; os links públicos abaixo, não.
let raiz = <ComLogin><App /></ComLogin>
if (share === 'dre' || share === 'balancete') {
  raiz = <RelatorioCompartilhadoPage
    tipo={share}
    empresaId={params.get('empresa')}
    dataInicio={params.get('inicio')}
    dataFim={params.get('fim')}
  />
} else if (share === 'notasfiscais') {
  raiz = <NotasFiscaisCompartilhadoPage
    empresaId={params.get('empresa')}
    competencia={params.get('competencia')}
  />
} else if (share === 'faturamento') {
  raiz = <ComprovanteFaturamentoPage empresaId={params.get('empresa')} />
} else if (identificar === '1') {
  const idsParam = params.get('ids')
  raiz = <IdentificarLancamentosPage
    empresaId={params.get('empresa')}
    dataInicio={params.get('inicio')}
    dataFim={params.get('fim')}
    ids={idsParam ? idsParam.split(',') : null}
    linkId={params.get('link')}
  />
} else if (doc) {
  raiz = <DocumentoCompartilhadoPage documentoId={doc} />
} else if (admissao) {
  // ficha de admissão do funcionário (?admissao=<token da admissão>, gerado em Clientes → Admissões)
  raiz = <FichaAdmissaoPage token={admissao} />
} else if (pedido) {
  // app instalável do cliente para pedir NF-e de venda (?pedido=<token do painel>)
  raiz = <PedidoNfePage token={pedido} />
} else if (notas) {
  // todas as NFS-e emitidas pela empresa (?notas=<token do painel>), lidas do Ambiente Nacional
  raiz = <NotasEmitidasPage token={notas} />
} else if (carteira) {
  // link da carteira (pessoa responsável pela carteira, sem login): lista as
  // empresas dela e abre o painel de cada uma — não conta como visita do cliente
  raiz = <PainelCarteiraPage token={carteira} competencia={params.get('competencia')} empresaInicial={params.get('empresa')} />
} else if (painel && painel.includes(',')) {
  // grupo de empresas num link só (?painel=id1,id2,...) — a visita/aviso
  // são registrados dentro do PainelGrupoPage, por empresa aberta
  const ids = [...new Set(painel.split(',').map((s) => s.trim()).filter(Boolean))]
  raiz = <PainelGrupoPage clienteIds={ids} competencia={params.get('competencia')}
    versao={params.get('versao') === '1' ? 'completa' : 'nova'} empresaInicial={params.get('empresa')} />
} else if (painel) {
  // log da visita do cliente (a última aparece pro escritório no topo do
  // painel) — falha silenciosa se a tabela ainda não existir
  registrarVisualizacaoPainel(painel, params.get('competencia'), params.get('versao') === '1' ? 'completa' : 'nova').catch(() => {})
  // e avisa o escritório (WhatsApp do grupo) que o cliente abriu o painel
  avisarEventoPainel(painel, 'visualizacao', { competencia: params.get('competencia') })
  // versão nova (só impostos anexados + pendências do Relatório de Situação
  // Fiscal) é o padrão; &versao=1 abre o painel completo antigo
  raiz = params.get('versao') === '1'
    ? <PainelClientePage clienteId={painel} competencia={params.get('competencia')} />
    : <PainelCompartilhadoPage clienteId={painel} competencia={params.get('competencia')} />
}

// Gestor como app instalável (tablet/celular). O <link rel=manifest> do
// gestor vem no index.html (o Chrome só oferece "Instalar" se achar o
// manifest no carregamento); nas páginas públicas ele sai, pra o painel do
// cliente usar o painel.webmanifest próprio (painelPush.js).
if (raiz.type === ComLogin) {
  // service worker: o mesmo arquivo do painel (mesmo escopo "/"), pra um
  // não substituir o registro do outro no mesmo navegador
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/painel-sw.js').catch(() => {})
  // guarda o convite de instalação do Chrome pra tela Hoje oferecer o botão
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    window.__convitePwa = e
    window.dispatchEvent(new Event('gestor-instalavel'))
  })
} else {
  document.getElementById('manifest-gestor')?.remove()
  if (pedido) {
    // manifest próprio já no carregamento, pra o Chrome oferecer "Instalar";
    // sem start_url: o ícone abre o link exato (com o token) daquele cliente
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/pedido-nfe.webmanifest'
    document.head.appendChild(link)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#249F64')
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {raiz}
  </React.StrictMode>
)
