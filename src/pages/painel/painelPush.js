// painelPush.js
// Notificações push do painel do cliente (Web Push): o cliente toca em
// "Ativar notificações" no painel compartilhado, o navegador dele cria uma
// assinatura (gravada em painel_push_assinaturas) e o escritório passa a
// poder mandar recados que chegam no celular mesmo com o painel fechado
// (netlify/functions/painel-push.js + public/painel-sw.js).
import { supabase, tokenPainelAtivo, cabecalhosFunctions, rpcAusente } from '../../lib/supabase';

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instaladoNaTelaInicial = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

// No iPhone/iPad o push só existe depois de "Adicionar à Tela de Início" —
// o manifest (sem start_url, pra o ícone abrir exatamente o link do painel
// daquele cliente) é o que faz o iOS tratar o painel como app. Só é
// colocado na página do painel, nunca no app do escritório.
export function prepararPainelComoApp() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/painel.webmanifest';
  document.head.appendChild(link);
}

// 'ativo' | 'disponivel' | 'bloqueado' (cliente negou no navegador) |
// 'ios_instalar' (precisa adicionar à tela de início antes) | 'sem_suporte'
export async function situacaoNotificacoesPainel() {
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!suporta) return ehIOS() && !instaladoNaTelaInicial() ? 'ios_instalar' : 'sem_suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  const registro = await navigator.serviceWorker.getRegistration('/painel-sw.js');
  const assinatura = registro ? await registro.pushManager.getSubscription() : null;
  return assinatura && Notification.permission === 'granted' ? 'ativo' : 'disponivel';
}

function chaveParaBytes(base64Url) {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Pede a permissão, cria a assinatura do aparelho e grava pro cliente.
// Precisa ser chamado a partir de um toque do usuário (exigência do navegador).
export async function ativarNotificacoesPainel(clienteId) {
  const resp = await fetch('/.netlify/functions/painel-push');
  const { chavePublica, error } = await resp.json().catch(() => ({}));
  if (!resp.ok || !chavePublica) throw new Error(error || 'Notificações indisponíveis no momento.');

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('Permissão de notificação não concedida.');

  const registro = await navigator.serviceWorker.register('/painel-sw.js');
  await navigator.serviceWorker.ready;
  const assinatura = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) });
  const { endpoint, keys } = assinatura.toJSON();

  const userAgent = navigator.userAgent.slice(0, 300);
  // No link público grava pela RPC, que confere o token do painel (o anônimo
  // não tem acesso direto à tabela). Sem a RPC no banco ainda, grava como antes.
  if (tokenPainelAtivo()) {
    const { error } = await supabase.rpc('painel_registrar_push', {
      p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: userAgent,
    });
    if (!rpcAusente(error)) {
      if (error) throw error;
      return;
    }
  }
  const { error: errGravar } = await supabase.from('painel_push_assinaturas').upsert({
    cliente_id: clienteId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent,
  }, { onConflict: 'endpoint' });
  if (errGravar) throw errGravar;
}

// Quantos aparelhos do cliente estão com as notificações ativas.
export async function contarAparelhosPush(clienteId) {
  const { count, error } = await supabase
    .from('painel_push_assinaturas')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId);
  if (error) throw error;
  return count || 0;
}

// Manda a notificação pra todos os aparelhos do cliente. Devolve { enviadas, total }.
export async function enviarNotificacaoCliente(clienteId, { titulo, mensagem, url }) {
  const resp = await fetch('/.netlify/functions/painel-push', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify({ clienteId, titulo, mensagem, url }),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Falha ao enviar a notificação.');
  return dados;
}
