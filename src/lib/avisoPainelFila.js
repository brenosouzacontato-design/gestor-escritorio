// avisoPainelFila.js — pergunta "avisar o cliente?" depois de anexar guia
//
// As funções que gravam guia (documentosApi: anexarDocumentoAoItem,
// confirmarDocumento; parcelamentosApi: salvarGuia) chamam
// perguntarAvisoPainel(clienteId); quem mostra a pergunta é o
// <AvisoPainelHost /> (components/AvisoPainelModal.jsx), montado no App.
// Empresa com "Não perguntar ao anexar" ou painel desligado (Central de
// Entregas → Empresas) fica de fora.
import { useStore } from '../store'

let ouvinte = null
const pendentes = [] // pedidos feitos antes do host montar

export function perguntarAvisoPainel(clienteId) {
  if (!clienteId) return
  const cliente = useStore.getState().clientes?.find((c) => c.id === clienteId)
  if (cliente && (cliente.aviso_guia_painel === false || cliente.painel_ativo === false)) return
  if (ouvinte) ouvinte(clienteId)
  else pendentes.push(clienteId)
}

// o host se registra; devolve a função para sair
export function ouvirPedidosDeAviso(fn) {
  ouvinte = fn
  pendentes.splice(0).forEach((id) => fn(id))
  return () => { if (ouvinte === fn) ouvinte = null }
}
