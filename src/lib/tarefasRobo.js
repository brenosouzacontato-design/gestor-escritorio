import { cabecalhosFunctions } from './supabase'

// Fila do robô do OneFlow (deploy/robo-parcelamentos/oneflow.py). Servidor:
// netlify/functions/tarefas-robo.js. Ver docs/robo-oneflow.md.

async function chamar(acao, dados = {}) {
  const r = await fetch('/.netlify/functions/tarefas-robo', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify({ acao, ...dados }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(corpo.erro || corpo.error || `Erro ${r.status}`), { status: r.status })
  return corpo
}

export const STATUS_ATIVOS = ['na_fila', 'processando', 'aguardando_pessoa']

export const ROTULO_STATUS = {
  na_fila: 'Na fila do robô',
  processando: 'Robô gerando…',
  aguardando_pessoa: 'Robô esperando login',
  ok: 'Pronto',
  erro: 'Erro',
  cancelada: 'Cancelada',
}

export async function listarTarefas(competencia, tipo = 'relatorio_folha') {
  const r = await chamar('listar', { competencia, tipo })
  return Object.fromEntries(r.tarefas.map((t) => [t.cliente_id, t]))
}

export const criarTarefas = (clienteIds, competencia, tipo = 'relatorio_folha') =>
  chamar('criar', { cliente_ids: clienteIds, competencia, tipo })

export const cancelarTarefa = (id) => chamar('cancelar', { id })
export const tentarDeNovo = (id) => chamar('tentar_de_novo', { id })

export async function abrirArquivo(id) {
  const { url } = await chamar('arquivo', { id })
  window.open(url, '_blank', 'noopener')
}
