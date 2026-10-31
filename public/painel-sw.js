// Service worker do painel do cliente — existe só pra receber as
// notificações push que o escritório manda (netlify/functions/painel-push.js)
// e abrir o painel quando o cliente toca nelas. Registrado por
// ativarNotificacoesPainel (src/pages/painel/painelPush.js) e também pelo
// app do escritório (src/main.jsx) — mesmo arquivo de propósito: os dois
// usam o escopo "/", e um SW diferente substituiria o registro do outro.
// Não guarda cache: o fetch abaixo só existe pra o Chrome do Android aceitar
// instalar o app, e mostra um aviso simples quando a página abre sem internet.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch { dados = { mensagem: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(dados.titulo || 'Recado do escritório', {
    body: dados.mensagem || '',
    data: { url: dados.url || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = abas.find((c) => !url || c.url === url);
    if (aberta) return aberta.focus();
    if (url) return self.clients.openWindow(url);
  })());
});

// Só navegação (abrir/recarregar página): vai pra rede normalmente; sem
// internet, devolve um aviso em vez da página de erro do navegador.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F4F1EC;color:#1B2B4B;text-align:center">' +
    '<div><h2>Sem conexão</h2><p>Confira a internet e toque para tentar de novo.</p>' +
    '<button onclick="location.reload()" style="padding:12px 20px;border-radius:999px;border:0;background:#249F64;color:#fff;font-size:16px">Tentar de novo</button></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});
