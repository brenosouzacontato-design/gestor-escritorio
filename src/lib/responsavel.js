// Responsável de tarefa/obrigação é texto livre (não há cadastro de
// usuários no app). O valor "Cliente" é especial: marca o item como
// pendência do próprio cliente, que aparece no painel compartilhado
// enquanto estiver pendente (ver obterTarefasDoCliente em painelApi.js).
export const RESPONSAVEL_CLIENTE = 'Cliente'

export function atribuidaAoCliente(item) {
  return (item?.responsavel || '').trim().toLowerCase() === 'cliente'
}
