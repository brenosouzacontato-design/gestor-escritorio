import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RelatorioCompartilhadoPage from './pages/contabil/RelatorioCompartilhadoPage.jsx'
import NotasFiscaisCompartilhadoPage from './pages/contabil/NotasFiscaisCompartilhadoPage.jsx'
import IdentificarLancamentosPage from './pages/contabil/IdentificarLancamentosPage.jsx'
import DocumentoCompartilhadoPage from './pages/documentos/DocumentoCompartilhadoPage.jsx'
import PainelClientePage from './pages/painel/PainelClientePage.jsx'
import PainelCompartilhadoPage from './pages/painel/PainelCompartilhadoPage.jsx'
import ComprovanteFaturamentoPage from './pages/painel/ComprovanteFaturamentoPage.jsx'
import { registrarVisualizacaoPainel } from './pages/painel/painelApi.js'
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

let raiz = <App />
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
} else if (painel) {
  // log da visita do cliente (a última aparece pro escritório no topo do
  // painel) — falha silenciosa se a tabela ainda não existir
  registrarVisualizacaoPainel(painel, params.get('competencia'), params.get('versao') === '1' ? 'completa' : 'nova').catch(() => {})
  // versão nova (só impostos anexados + pendências do Relatório de Situação
  // Fiscal) é o padrão; &versao=1 abre o painel completo antigo
  raiz = params.get('versao') === '1'
    ? <PainelClientePage clienteId={painel} competencia={params.get('competencia')} />
    : <PainelCompartilhadoPage clienteId={painel} competencia={params.get('competencia')} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {raiz}
  </React.StrictMode>
)
