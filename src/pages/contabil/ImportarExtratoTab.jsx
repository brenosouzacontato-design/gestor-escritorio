import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowDownCircleIcon, ArrowUpCircleIcon, CheckCircle2Icon, CircleDashedIcon, ListIcon } from 'lucide-react';
// @cantoo/pdf-lib é um fork do pdf-lib com suporte real a descriptografia
// (o pdf-lib original só tem a flag ignoreEncryption, que pula o erro de
// carregamento mas não descriptografa o conteúdo de verdade — ver comentário
// mais abaixo em extrairTransacoesComDivisao)
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  listarContasBanco, listarContasReceitaDespesa, listarLancamentos, criarLancamentosEmLote,
  listarRegrasClassificacao, salvarRegraClassificacao, encontrarRegraAplicavel,
} from './contabilApi';
import { extrairTransacoesDeExcel } from './excelExtrato';
import ContaCombobox from './ContaCombobox';

// Contrapartida usada quando a transação é salva sem conta classificada ainda
// (faz parte do plano de contas padrão importado — ver scripts/plano_contas_oneflow.json)
const CODIGO_CONTA_PENDENTE = '1.1.01.001.002'; // "Valores a Identificar"

/**
 * Chama a Netlify Function netlify/functions/extrair-extrato.js. Ela manda
 * o PDF direto pro Claude (suporte nativo a PDF, sem precisar extrair texto
 * antes) e devolve as transações já estruturadas. A chave da Anthropic fica
 * só no servidor (env var ANTHROPIC_API_KEY no Netlify), nunca no client.
 *
 * Contrato de retorno: { transacoes: [...], truncado: boolean }, onde cada
 * transação é
 *   { data: 'YYYY-MM-DD', descricao: string, identificador: string|null, valor: number, tipo: 'entrada' | 'saida' }
 * "identificador" é o código de controle da transação no banco (nº do PIX,
 * nosso número de boleto etc), quando o extrato traz um — vai pro
 * numero_documento do lançamento. "truncado" vem true quando o extrato tinha
 * transações demais e a resposta do modelo foi cortada pelo limite de
 * tamanho — nesse caso só as transações que vieram completas são devolvidas.
 */
async function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // remove o prefixo data:application/pdf;base64,
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo PDF.'));
    reader.readAsDataURL(arquivo);
  });
}

async function extrairTransacoesDoPDF(arquivo, nomeArquivo) {
  const pdfBase64 = await arquivoParaBase64(arquivo);

  const resp = await fetch('/.netlify/functions/extrair-extrato', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdfBase64, filename: nomeArquivo ?? arquivo.name }),
  });

  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao extrair o extrato.');
  }
  return resp.json();
}

// Extratos longos (bancos com muita movimentação, 15+ páginas) demoram demais
// pro Claude ler o PDF inteiro e gerar o JSON numa única chamada — a função
// do Netlify estoura o tempo de execução e cai num 504 antes de responder.
// Pra evitar isso, quebra o PDF em partes de poucas páginas e manda cada uma
// numa chamada separada; as partes usam 1 página de sobreposição pra não
// perder transação que atravesse a quebra de página, e eventuais duplicatas
// resultantes disso são descartadas depois pelo índice único de
// extrato_referencia no banco (ver criarLancamentosEmLote).
const PAGINAS_POR_PARTE = 4;
const PARTES_SIMULTANEAS = 3;

async function extrairTransacoesComDivisao(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  // muitos bancos exportam o extrato com permissões restritas (cópia/edição
  // bloqueada) via senha de dono, sem senha de abertura — uma string vazia é
  // a senha certa pra esses casos. O pdf-lib original só tem uma flag
  // "ignoreEncryption" que pula o erro de carregamento mas não descriptografa
  // o conteúdo de verdade (copiar página assim gera um PDF corrompido) — por
  // isso usamos o fork @cantoo/pdf-lib, que descriptografa de verdade.
  const doc = await PDFDocument.load(bytes, { password: '' });
  const totalPaginas = doc.getPageCount();

  if (totalPaginas <= PAGINAS_POR_PARTE) {
    return extrairTransacoesDoPDF(arquivo);
  }

  const partes = [];
  for (let inicio = 0; inicio < totalPaginas; inicio += PAGINAS_POR_PARTE) {
    const fim = Math.min(inicio + PAGINAS_POR_PARTE, totalPaginas);
    const inicioComSobreposicao = inicio === 0 ? 0 : inicio - 1;
    const indices = Array.from({ length: fim - inicioComSobreposicao }, (_, i) => inicioComSobreposicao + i);
    const parte = await PDFDocument.create();
    const paginas = await parte.copyPages(doc, indices);
    paginas.forEach((p) => parte.addPage(p));
    partes.push(await parte.save());
  }

  const transacoes = [];
  const falhas = [];
  let truncado = false;
  for (let i = 0; i < partes.length; i += PARTES_SIMULTANEAS) {
    const lote = partes.slice(i, i + PARTES_SIMULTANEAS);
    const resultados = await Promise.allSettled(
      lote.map((bytesParte, j) => {
        const blob = new Blob([bytesParte], { type: 'application/pdf' });
        return extrairTransacoesDoPDF(blob, `${arquivo.name} (parte ${i + j + 1}/${partes.length})`);
      })
    );
    resultados.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        transacoes.push(...r.value.transacoes);
        truncado = truncado || r.value.truncado;
      } else {
        falhas.push(`parte ${i + j + 1}/${partes.length}: ${r.reason?.message || 'falha desconhecida'}`);
      }
    });
  }

  if (falhas.length > 0) truncado = true;
  return { transacoes, truncado, falhas: falhas.length > 0 ? falhas : undefined };
}

// Sugere uma conta pra transação olhando lançamentos anteriores com
// histórico parecido (reaproveita a classificação que você já fez antes
// pra descrições semelhantes, tipo "PIX RECEBIDO JOAO"). Bem simples de
// propósito — é só um ponto de partida, dá pra evoluir depois.
function sugerirConta(descricao, lancamentosAnteriores, contas) {
  const descNorm = descricao.toLowerCase().trim();
  let melhor = null;
  let melhorScore = 0;

  for (const l of lancamentosAnteriores) {
    if (l.origem !== 'importacao_extrato' && !l.historico) continue;
    const histNorm = (l.historico || '').toLowerCase().trim();
    if (!histNorm) continue;
    // score simples: quantidade de palavras em comum
    const palavrasA = new Set(descNorm.split(/\s+/).filter((w) => w.length > 2));
    const palavrasB = new Set(histNorm.split(/\s+/).filter((w) => w.length > 2));
    const comuns = [...palavrasA].filter((w) => palavrasB.has(w)).length;
    if (comuns > melhorScore) {
      melhorScore = comuns;
      const partidaNaoBanco = l.partidas_contabeis?.find((p) => !contas.bancoIds.has(p.conta_id));
      melhor = partidaNaoBanco?.conta_id ?? null;
    }
  }
  return melhorScore > 0 ? melhor : null;
}

export default function ImportarExtratoTab({ empresaId }) {
  // contasBanco: só as contas de banco/caixa, pro seletor do topo.
  // contasClassificacao: só Receita/Despesa, pro seletor de cada linha —
  // é isso que faz a importação virar "conciliação que classifica em
  // Receita/Despesa" em vez de escolher qualquer conta do plano.
  const [contasBanco, setContasBanco] = useState([]);
  const [contasClassificacao, setContasClassificacao] = useState([]);
  const [contaBancoId, setContaBancoId] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [transacoes, setTransacoes] = useState([]); // [{...extraida, conta_id, ignorar}]
  const [erro, setErro] = useState(null);
  const [info, setInfo] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    listarContasBanco(empresaId).then(setContasBanco);
    // contas sintéticas (aceita_lancamento=false) não recebem lançamento
    // direto — não fazem sentido como opção nesse seletor.
    listarContasReceitaDespesa(empresaId).then((c) => setContasClassificacao(c.filter((x) => x.aceita_lancamento)));
  }, [empresaId]);

  function onDrop(e) {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setArquivo(f);
  }

  async function processar() {
    if (!arquivo || !contaBancoId) {
      setErro('Selecione a conta bancária e o arquivo do extrato.');
      return;
    }
    setErro(null);
    setInfo(null);
    setProcessando(true);
    try {
      const ehExcel = /\.(xlsx|xls)$/i.test(arquivo.name);
      const [extracao, historico, regras] = await Promise.all([
        ehExcel ? extrairTransacoesDeExcel(arquivo) : extrairTransacoesComDivisao(arquivo),
        listarLancamentos(empresaId, {}),
        // regras de classificação são só um bônus — se falhar (ex: tabela
        // ainda não migrada), a extração não pode travar por causa disso
        listarRegrasClassificacao(empresaId).catch(() => []),
      ]);
      const extraidas = extracao.transacoes;
      const bancoIds = new Set([contaBancoId]);
      // só aceita sugestão (de regra ou por histórico) se apontar pra uma
      // conta que realmente aparece no seletor — sem isso, um lançamento
      // antigo ainda pendente em "Valores a Identificar" podia "sugerir"
      // a própria conta transitória, marcando a transação como classificada
      // sem nenhuma conta selecionável de verdade aparecer no combobox
      const idsClassificaveis = new Set(contasClassificacao.map((c) => c.id));
      let autoClassificadas = 0;
      const comSugestao = extraidas.map((t) => {
        // 1) regra aprendida (ou cadastrada manualmente) que apareça no
        // histórico tem prioridade; 2) senão cai pra sugestão fraca por
        // palavras em comum
        const regra = encontrarRegraAplicavel(t.descricao, regras);
        let contaId = regra?.conta_id ?? sugerirConta(t.descricao, historico, { bancoIds }) ?? '';
        if (contaId && !idsClassificaveis.has(contaId)) contaId = '';
        if (regra && contaId) autoClassificadas++;
        return { ...t, conta_id: contaId, ignorar: false };
      });
      setTransacoes(comSugestao);
      const avisos = [];
      if (extracao.falhas) {
        avisos.push(`⚠ Não consegui processar ${extracao.falhas.length} trecho${extracao.falhas.length === 1 ? '' : 's'} do extrato (${extracao.falhas.join('; ')}). As transações desses trechos não vieram — tente reimportar o período correspondente separado.`);
      } else if (extracao.truncado) {
        avisos.push(`⚠ O extrato tinha transações demais pra processar de uma vez — só ${extraidas.length} vieram completas. Confira o total no extrato original e importe o restante separado (outro período/arquivo).`);
      }
      if (extracao.linhasIgnoradas) {
        avisos.push(`⚠ ${extracao.linhasIgnoradas} linha${extracao.linhasIgnoradas === 1 ? '' : 's'} da planilha não pôde${extracao.linhasIgnoradas === 1 ? '' : 'ram'} ser lida${extracao.linhasIgnoradas === 1 ? '' : 's'} (data ou valor ausente/ilegível) e foi${extracao.linhasIgnoradas === 1 ? '' : 'ram'} ignorada${extracao.linhasIgnoradas === 1 ? '' : 's'}.`);
      }
      if (autoClassificadas > 0) {
        avisos.push(`${autoClassificadas} transaç${autoClassificadas === 1 ? 'ão' : 'ões'} classificada${autoClassificadas === 1 ? '' : 's'} automaticamente com base em lançamentos anteriores.`);
      }
      if (avisos.length > 0) setInfo(avisos.join(' '));
    } catch (e) {
      setErro(e.message);
    } finally {
      setProcessando(false);
    }
  }

  function atualizarTransacao(idx, campo, valor) {
    setTransacoes((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  }

  // resumo ao vivo pros cards acima da tabela — atualiza a cada classificação
  const resumo = useMemo(() => {
    const validas = transacoes.filter((t) => !t.ignorar);
    const classificadas = validas.filter((t) => t.conta_id);
    const totalEntrada = validas.filter((t) => t.tipo === 'entrada').reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
    const totalSaida = validas.filter((t) => t.tipo === 'saida').reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
    return {
      total: validas.length,
      classificadas: classificadas.length,
      pendentes: validas.length - classificadas.length,
      totalEntrada,
      totalSaida,
    };
  }, [transacoes]);

  async function confirmarImportacao() {
    setSalvando(true);
    setErro(null);
    setInfo(null);
    try {
      const contaPendente = contasBanco.find((c) => c.codigo === CODIGO_CONTA_PENDENTE);
      const validas = transacoes.filter((t) => !t.ignorar);

      const itens = validas.map((t) => {
        // sem conta classificada ainda: lança em "Valores a Identificar" pra
        // não perder a transação, e fica pra conciliar depois nos Lançamentos
        const contraId = t.conta_id || contaPendente?.id;
        if (!contraId) {
          throw new Error(`Não achei a conta "Valores a Identificar" (código ${CODIGO_CONTA_PENDENTE}) no plano dessa empresa, e a transação "${t.descricao}" não tem conta selecionada.`);
        }
        const valor = Math.abs(Number(t.valor));
        const partidas = t.tipo === 'entrada'
          ? [
              { conta_id: contaBancoId, tipo: 'debito', valor },
              { conta_id: contraId, tipo: 'credito', valor },
            ]
          : [
              { conta_id: contraId, tipo: 'debito', valor },
              { conta_id: contaBancoId, tipo: 'credito', valor },
            ];
        // identifica a transação de forma estável pra não duplicar se o
        // mesmo extrato (ou um período sobreposto) for reimportado depois —
        // usa o identificador do banco quando tem, senão cai pra descrição
        const extratoReferencia = [contaBancoId, t.data, t.tipo, valor.toFixed(2), t.identificador || t.descricao.trim()].join('|');
        return {
          data: t.data,
          historico: t.descricao,
          numeroDocumento: t.identificador || null,
          origem: 'importacao_extrato',
          extratoReferencia,
          conciliado: !!t.conta_id,
          partidas,
        };
      });

      const { criados, pulados } = await criarLancamentosEmLote(empresaId, itens);

      // reforça/aprende as regras de classificação com o que foi confirmado
      // agora (seja de uma regra já existente, sugestão ou escolha manual)
      const classificadas = validas.filter((t) => t.conta_id);
      await Promise.all(
        classificadas.map((t) => salvarRegraClassificacao(empresaId, t.descricao, t.conta_id).catch(() => {}))
      );

      setTransacoes([]);
      setArquivo(null);
      if (pulados > 0) {
        setInfo(`${criados} lançamento${criados === 1 ? '' : 's'} gerado${criados === 1 ? '' : 's'}. ${pulados} já tinha${pulados === 1 ? '' : 'm'} sido importado${pulados === 1 ? '' : 's'} antes (mesma data/valor/descrição) e ${pulados === 1 ? 'foi' : 'foram'} ignorado${pulados === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="contabil-form">
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, marginBottom: 12 }}>
          <ContaCombobox contas={contasBanco} value={contaBancoId} onChange={setContaBancoId} placeholder="Conta bancária do extrato..." />
        </div>

        <div
          className="contabil-dropzone"
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={onDrop}
          data-arrastando={arrastando}
        >
          {arquivo ? (
            <span>{arquivo.name}</span>
          ) : (
            <span>Arraste o PDF ou Excel do extrato aqui, ou <label style={{ color: 'var(--navy2)', cursor: 'pointer', textDecoration: 'underline' }}>
              selecione um arquivo
              <input type="file" accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }}
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label></span>
          )}
        </div>

        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
        {info && <p style={{ color: 'var(--text2)', marginTop: 8 }}>{info}</p>}

        <button className="btn-navy" style={{ marginTop: 12 }} onClick={processar} disabled={processando}>
          {processando ? 'Processando...' : 'Extrair transações'}
        </button>
      </div>

      {transacoes.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
            <ResumoCard icone={<ListIcon size={14} />} label="Transações" valor={resumo.total} cor="var(--navy2)" />
            <ResumoCard icone={<CheckCircle2Icon size={14} />} label="Classificadas" valor={`${resumo.classificadas} (${resumo.total ? Math.round(resumo.classificadas / resumo.total * 100) : 0}%)`} cor="var(--ok)" />
            <ResumoCard icone={<CircleDashedIcon size={14} />} label="Pendentes" valor={resumo.pendentes} cor={resumo.pendentes > 0 ? 'var(--warn)' : 'var(--ok)'} />
            <ResumoCard icone={<ArrowDownCircleIcon size={14} />} label="Total entrada" valor={`R$ ${resumo.totalEntrada.toFixed(2)}`} cor="var(--ok)" />
            <ResumoCard icone={<ArrowUpCircleIcon size={14} />} label="Total saída" valor={`R$ ${resumo.totalSaida.toFixed(2)}`} cor="var(--danger)" />
          </div>

          <table className="contabil-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th style={{ whiteSpace: 'nowrap' }}>Natureza</th>
                <th>Descrição</th>
                <th>Identificador</th>
                <th className="num">Valor</th>
                <th>Conta (contrapartida)</th>
                <th>Ignorar</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, idx) => (
                <tr key={idx}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className="badge-origem" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: t.tipo === 'entrada' ? 'var(--ok-dim)' : 'var(--danger-dim)',
                      color: t.tipo === 'entrada' ? 'var(--ok)' : 'var(--danger)',
                    }}>
                      {t.tipo === 'entrada' ? <ArrowDownCircleIcon size={13} /> : <ArrowUpCircleIcon size={13} />}
                      {t.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td>{t.descricao}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{t.identificador || '—'}</td>
                  <td className={`num ${t.tipo === 'saida' ? 'valor-negativo' : 'valor-positivo'}`} style={{ whiteSpace: 'nowrap' }}>
                    R$ {Math.abs(Number(t.valor)).toFixed(2)}
                  </td>
                  <td style={{ minWidth: 240 }}>
                    <ContaCombobox contas={contasClassificacao} value={t.conta_id}
                      onChange={(id) => atualizarTransacao(idx, 'conta_id', id)}
                      placeholder="Receita ou despesa..." style={{ width: '100%' }} />
                  </td>
                  <td>
                    <input type="checkbox" checked={t.ignorar}
                      onChange={(e) => atualizarTransacao(idx, 'ignorar', e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: 8 }}>
            Transações sem conta selecionada são lançadas em "Valores a Identificar" pra não se perder — dá pra classificar depois direto na aba Lançamentos.
          </p>
          <button className="btn-navy" style={{ marginTop: 8 }} onClick={confirmarImportacao} disabled={salvando}>
            {salvando ? 'Gerando lançamentos...' : `Confirmar e gerar ${transacoes.filter(t => !t.ignorar).length} lançamentos`}
          </button>
        </>
      )}
    </div>
  );
}

function ResumoCard({ icone, label, valor, cor }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text2)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.02em' }}>
        {icone} {label}
      </div>
      <div className="num" style={{ fontSize: '1.15rem', fontWeight: 700, color: cor, marginTop: 4 }}>{valor}</div>
    </div>
  );
}
