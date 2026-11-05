// Roteiro para emitir um pedido de NF-e no Emissor (sistema.emissor.app) pelo Claude (Cowork),
// enquanto o robô do servidor não tem acesso ao Emissor. O escritório copia e cola no Claude.
import { fmtDocumento, numeroPedido } from './pedidoNfeApi';

const FRETE_EMISSOR = {
  sem_frete: 'Sem ocorrência de transporte (9)',
  emitente: 'Por conta do remetente/emitente – CIF (0)',
  destinatario: 'Por conta do destinatário – FOB (1)',
  terceiros: 'Por conta de terceiros (2)',
};

const reais = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numero = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export function roteiroClaude(p) {
  const d = p.destinatario || {};
  const itens = p.itens || [];
  const descontos = itens.reduce((s, i) => s + (Number(i.desconto) || 0), 0);
  const endereco = [
    [d.logradouro, d.numero].filter(Boolean).join(', '),
    d.complemento, d.bairro, `${d.municipio || ''}/${d.uf || ''}`, d.cep ? `CEP ${d.cep}` : '',
  ].filter(Boolean).join(' – ');

  const linhas = [
    `Emita uma NF-e de venda no Emissor (https://sistema.emissor.app), no navegador onde já estou logado no painel de parceiro.`,
    '',
    `PEDIDO ${numeroPedido(p.id)}`,
    '',
    `1. Empresa emitente: ${p.clientes?.nome || ''} – CNPJ ${fmtDocumento(p.clientes?.cnpj)}.`,
    `   Abra a aba Empresas, procure pelo CNPJ e, no cadastro marcado como "Ativa", use Opções → Acessar.`,
    `2. Vá em Notas → NF-e → Emitir.`,
    `3. Destinatário: ${d.nome || ''} – ${fmtDocumento(d.documento)}${d.ie ? ` – IE ${d.ie}` : ' – sem IE (não contribuinte)'}.`,
    `   Endereço: ${endereco}.${d.telefone ? ` Telefone: ${d.telefone}.` : ''}${d.email ? ` E-mail: ${d.email}.` : ''}`,
    `   Se não estiver cadastrado no Emissor, cadastre com esses dados.`,
    `4. Produtos (se algum não existir no Emissor, cadastre com o NCM e a unidade abaixo e o grupo tributário padrão da empresa):`,
    ...itens.map((i, n) => `   ${n + 1}) ${i.descricao}${i.codigo ? ` (cód. ${i.codigo})` : ''} – NCM ${i.ncm || 'NÃO INFORMADO'} – ${numero(i.quantidade)} ${i.unidade || 'UN'} × ${reais(i.valor_unitario)} = ${reais(i.valor_total)}${Number(i.desconto) > 0 ? ` – desconto ${reais(i.desconto)}` : ''}`),
    `5. Frete: ${FRETE_EMISSOR[p.frete_modalidade] || 'Sem ocorrência de transporte (9)'}${Number(p.frete_valor) > 0 ? ` – valor do frete ${reais(p.frete_valor)}` : ''}.`,
    p.observacao ? `6. Informações complementares: ${p.observacao}` : `6. Sem informações complementares.`,
    '',
    `CONFERÊNCIA: produtos ${reais(p.valor_produtos)}${descontos > 0 ? ` – descontos ${reais(descontos)}` : ''}${Number(p.frete_valor) > 0 ? ` + frete ${reais(p.frete_valor)}` : ''} = TOTAL DA NOTA ${reais(p.valor_total)}.`,
    `Se o total do Emissor for diferente, pare e me diga a diferença.`,
    '',
    `IMPORTANTE: preencha tudo e PARE antes de clicar em "Gerar Nota". Me mostre o resumo e espere eu confirmar.`,
    `Depois de gerada, baixe o DANFE (PDF) e o XML e me informe o número da nota e a chave de acesso.`,
  ];
  if (itens.some((i) => !i.ncm)) linhas.unshift('ATENÇÃO: há produto sem NCM neste pedido; confirme o NCM comigo antes de emitir.', '');
  return linhas.join('\n');
}
