// simplesNacional.js
//
// Tabelas oficiais dos Anexos I a V do Simples Nacional (Lei Complementar
// 123/2006, redação dada pela LC 155/2016 — em vigor desde 01/01/2018,
// sem alteração desde então). Cada faixa é [rbt12Min, rbt12Max, alíquota
// nominal, parcela a deduzir]. Usada só pra calcular a alíquota "cheia" —
// o que a empresa pagaria pela tabela do Simples se não tivesse nenhum
// aproveitamento de crédito (ex: segregação de receita por ST/monofásico
// que reduz o DAS efetivamente pago) — ver calcularAliquotaNominal.
//
// Fonte: Lei Complementar 123/2006, Anexos I-V (redação LC 155/2016).
// Revisar esta tabela se a legislação do Simples Nacional mudar.
const TABELA_SIMPLES = {
  I: [ // Comércio
    [0, 180000, 0.04, 0],
    [180000, 360000, 0.073, 5940],
    [360000, 720000, 0.095, 13860],
    [720000, 1800000, 0.107, 22500],
    [1800000, 3600000, 0.143, 87300],
    [3600000, 4800000, 0.19, 378000],
  ],
  II: [ // Indústria
    [0, 180000, 0.045, 0],
    [180000, 360000, 0.078, 5940],
    [360000, 720000, 0.10, 13860],
    [720000, 1800000, 0.112, 22500],
    [1800000, 3600000, 0.147, 85500],
    [3600000, 4800000, 0.30, 720000],
  ],
  III: [ // Serviços (locação de bens móveis e serviços em geral)
    [0, 180000, 0.06, 0],
    [180000, 360000, 0.112, 9360],
    [360000, 720000, 0.135, 17640],
    [720000, 1800000, 0.16, 35640],
    [1800000, 3600000, 0.21, 125640],
    [3600000, 4800000, 0.33, 648000],
  ],
  IV: [ // Serviços (construção, vigilância, limpeza, advocacia etc. — sem CPP no DAS)
    [0, 180000, 0.045, 0],
    [180000, 360000, 0.09, 8100],
    [360000, 720000, 0.102, 12420],
    [720000, 1800000, 0.14, 39780],
    [1800000, 3600000, 0.22, 183780],
    [3600000, 4800000, 0.33, 828000],
  ],
  V: [ // Serviços intelectuais (Fator R < 28%)
    [0, 180000, 0.155, 0],
    [180000, 360000, 0.18, 4500],
    [360000, 720000, 0.195, 9900],
    [720000, 1800000, 0.205, 17100],
    [1800000, 3600000, 0.23, 62100],
    [3600000, 4800000, 0.305, 540000],
  ],
};

function normalizarAnexo(anexo) {
  const v = (anexo || '').toString().trim().toUpperCase();
  if (v === 'I' || v === '1') return 'I';
  if (v === 'II' || v === '2') return 'II';
  if (v === 'III' || v === '3') return 'III';
  if (v === 'IV' || v === '4') return 'IV';
  if (v === 'V' || v === '5') return 'V';
  return null;
}

// Alíquota nominal (%) da tabela do Simples pra esse anexo/RBT12 — a
// alíquota "cheia", sem nenhuma redução por segregação de receita.
// null quando o anexo não é reconhecido ou o RBT12 passa do teto do
// Simples Nacional (R$ 4.800.000,00 — fora da tabela).
export function calcularAliquotaNominal(anexo, rbt12) {
  const anexoNorm = normalizarAnexo(anexo);
  if (!anexoNorm || rbt12 == null || rbt12 <= 0) return null;
  const faixas = TABELA_SIMPLES[anexoNorm];
  const faixa = faixas.find(([min, max]) => rbt12 > min && rbt12 <= max);
  if (!faixa) return null;
  const [, , aliquotaNominal, parcelaDeduzir] = faixa;
  return (((rbt12 * aliquotaNominal) - parcelaDeduzir) / rbt12) * 100;
}
