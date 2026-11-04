// gestorPush.js
// Avisos no aparelho pra equipe do escritório: o usuário toca em "Ativar
// avisos neste aparelho" (tela Tarefas), o navegador cria uma assinatura
// Web Push e os lembretes com hora marcada passam a chegar como notificação
// (netlify/functions/gestor-push.js + lembretes-cron.js + public/painel-sw.js).
import { cabecalhosFunctions } from './supabase'

const URL_FN = '/.netlify/functions/gestor-push'

export const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const appInstalado = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

function chaveParaBytes(base64Url) {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

async function chamar(dados) {
  const resp = await fetch(URL_FN, { method: 'POST', headers: await cabecalhosFunctions(), body: JSON.stringify(dados) })
  const r = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(r.error || 'Falha ao falar com o servidor de avisos.')
  return r
}

async function assinaturaAtual() {
  const registro = await navigator.serviceWorker.getRegistration('/')
  return registro ? registro.pushManager.getSubscription() : null
}

// 'ativo' | 'disponivel' | 'bloqueado' | 'ios_instalar' (iPhone/iPad: só
// funciona com o app adicionado à Tela de Início) | 'sem_suporte'
export async function situacaoAvisos() {
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!suporta) return ehIOS() && !appInstalado() ? 'ios_instalar' : 'sem_suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  const assinatura = await assinaturaAtual()
  return assinatura && Notification.permission === 'granted' ? 'ativo' : 'disponivel'
}

// Precisa ser chamado a partir de um toque (exigência do navegador).
export async function ativarAvisos() {
  const resp = await fetch(URL_FN, { headers: await cabecalhosFunctions() })
  const { chavePublica, error } = await resp.json().catch(() => ({}))
  if (!resp.ok || !chavePublica) throw new Error(error || 'Avisos no aparelho indisponíveis no momento.')

  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('O navegador não deu permissão para notificações.')

  const registro = await navigator.serviceWorker.register('/painel-sw.js')
  await navigator.serviceWorker.ready
  let assinatura = await registro.pushManager.getSubscription()
  if (!assinatura) {
    assinatura = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) })
  }
  const { endpoint, keys } = assinatura.toJSON()
  await chamar({ acao: 'assinar', endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: navigator.userAgent })
  await chamar({ acao: 'testar', endpoint }).catch(() => {})
}

export async function desativarAvisos() {
  const assinatura = await assinaturaAtual()
  if (!assinatura) return
  await chamar({ acao: 'remover', endpoint: assinatura.endpoint }).catch(() => {})
  await assinatura.unsubscribe()
}
