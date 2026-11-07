// Constantes do plano de contas compartilhadas pelo módulo contábil.
//
// O Gestor convive com dois planos:
//  - Plano Padrão OneFlow (743 contas, 6 níveis) — o que foi importado
//    originalmente (scripts/plano_contas_oneflow.json);
//  - Plano Enxuto Breno Contador (~90 contas analíticas, 4 níveis) — o mesmo
//    plano cadastrado no OneFlow (scripts/plano_contas_enxuto.json), aplicado
//    por empresa com scripts/aplicar-plano-enxuto.cjs.
// Nos dois o grupo "Disponível" é 1.1.01 e a transitória "Valores a
// Identificar" mora dentro dele, só muda o código.

export const PREFIXO_DISPONIVEL = '1.1.01';

export const CODIGOS_CONTA_PENDENTE = [
  '1.1.01.001.002', // Plano Padrão OneFlow
  '1.1.01.099', // Plano Enxuto Breno Contador
];

export function ehContaPendente(codigo) {
  return CODIGOS_CONTA_PENDENTE.includes(codigo);
}

export function acharContaPendente(contas) {
  return contas.find((c) => ehContaPendente(c.codigo));
}
