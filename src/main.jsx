import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RelatorioCompartilhadoPage from './pages/contabil/RelatorioCompartilhadoPage.jsx'
import './styles.css'

// Link compartilhado (Balancete/DRE via WhatsApp) — renderiza só a página
// pública de relatório, sem montar o app inteiro (evita disparar o
// carregamento pesado da store à toa numa página que é só leitura).
const params = new URLSearchParams(window.location.search)
const share = params.get('share')

const raiz = (share === 'dre' || share === 'balancete')
  ? <RelatorioCompartilhadoPage
      tipo={share}
      empresaId={params.get('empresa')}
      dataInicio={params.get('inicio')}
      dataFim={params.get('fim')}
    />
  : <App />

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {raiz}
  </React.StrictMode>
)
