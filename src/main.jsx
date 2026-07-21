import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RelatorioCompartilhadoPage from './pages/contabil/RelatorioCompartilhadoPage.jsx'
import IdentificarLancamentosPage from './pages/contabil/IdentificarLancamentosPage.jsx'
import './styles.css'

// Links compartilhados (Balancete/DRE e identificação de lançamentos via
// WhatsApp) — renderizam só a página pública correspondente, sem montar o
// app inteiro (evita disparar o carregamento pesado da store à toa numa
// página que é só leitura/preenchimento simples).
const params = new URLSearchParams(window.location.search)
const share = params.get('share')
const identificar = params.get('identificar')

let raiz = <App />
if (share === 'dre' || share === 'balancete') {
  raiz = <RelatorioCompartilhadoPage
    tipo={share}
    empresaId={params.get('empresa')}
    dataInicio={params.get('inicio')}
    dataFim={params.get('fim')}
  />
} else if (identificar === '1') {
  raiz = <IdentificarLancamentosPage
    empresaId={params.get('empresa')}
    dataInicio={params.get('inicio')}
    dataFim={params.get('fim')}
  />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {raiz}
  </React.StrictMode>
)
