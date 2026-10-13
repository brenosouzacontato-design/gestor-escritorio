// Service worker do painel do cliente — existe só pra receber as
// notificações push que o escritório manda (netlify/functions/painel-push.js)
// e abrir o painel quando o cliente toca nelas. Registrado por
// ativarNotificacoesPainel (src/pages/painel/painelPush.js); não faz cache
// de nada nem intercepta requisições.

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
