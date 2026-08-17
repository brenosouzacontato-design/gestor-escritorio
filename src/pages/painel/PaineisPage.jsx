import { useState, useMemo, useEffect } from 'react'
import { Share2Icon, MonitorIcon } from 'lucide-react'
import { useStore } from '../../store'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import PainelClientePage from './PainelClientePage'

const CHAVE_ULTIMO_CLIENTE = 'paineis-cliente-selecionado'

// Módulo dedicado a ver e compartilhar o painel dos clientes — abre direto
// no painel (sem passar por uma listagem antes), trocando de empresa pela
// combobox com busca no topo. Antes só dava pra abrir o painel de dentro
// do modal de uma empresa em Empresas.jsx; aqui é o ponto de entrada direto.
export default function PaineisPage() {
  const clientes = useStore(s => s.clientes)
  const compSel = useStore(s => s.competenciaSelecionada)
  const [clienteId, setClienteId] = useState(() => localStorage.getItem(CHAVE_ULTIMO_CLIENTE) || '')

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
    const link = `${window.location.origin}${window.location.pathname}?painel=${clienteAtual.id}&competencia=${encodeURIComponent(compSel)}`
    const mensagem = `Olá! Segue o painel de ${clienteAtual.nome} — competência ${compSel} — com obrigações, financeiro e demais informações:\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorIcon size={18} /> Painéis
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Escolha a empresa pra ver e compartilhar o painel — competência {compSel}.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <EmpresaCombobox empresas={clientesOrdenados} value={clienteId} onChange={setClienteId}
          placeholder="Escolher empresa..." style={{ flex: 1, minWidth: 240 }} />
        <button onClick={compartilhar} disabled={!clienteAtual} className="btn btn-accent" style={{ padding: '7px 14px' }}>
          <Share2Icon size={13} /> Compartilhar
        </button>
      </div>

      {!clienteAtual && (
        <div className="empty">
          <p>🖥️</p>
          Nenhuma empresa cadastrada.
        </div>
      )}

      {clienteAtual && <PainelClientePage key={clienteAtual.id} clienteId={clienteAtual.id} competencia={compSel} />}
    </div>
  )
}
