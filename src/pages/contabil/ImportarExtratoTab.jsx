import React, { useState, useEffect, useCallback } from 'react';
import { listarContas, listarLancamentos, criarLancamentosEmLote } from './contabilApi';

// Contrapartida usada quando a transação é salva sem conta classificada ainda
// (faz parte do plano de contas padrão importado — ver scripts/plano_contas_oneflow.json)
const CODIGO_CONTA_PENDENTE = '1.1.01.001.002'; // "Valores a Identificar"

/**
 * Chama a Netlify Function netlify/functions/extrair-extrato.js. Ela manda
 * o PDF direto pro Claude (suporte nativo a PDF, sem precisar extrair texto
 * antes) e devolve as transações já estruturadas. A chave da Anthropic fica
 * só no servidor (env var ANTHROPIC_API_KEY no Netlify), nunca no client.
 *
 * Contrato de retorno: array de
 *   { data: 'YYYY-MM-DD', descricao: string, valor: number, tipo: 'entrada' | 'saida' }
 */
async function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // remove o prefixo data:application/pdf;base64,
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo PDF.'));
    reader.readAsDataURL(arquivo);
  });
}

async function extrairTransacoesDoPDF(arquivo) {
  const pdfBase64 = await arquivoParaBase64(arquivo);

  const resp = await fetch('/.netlify/functions/extrair-extrato', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdfBase64, filename: arquivo.name }),
  });

  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao extrair o extrato.');
  }
  return resp.json();
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
  const [contas, setContas] = useState([]);
  const [contaBancoId, setContaBancoId] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [transacoes, setTransacoes] = useState([]); // [{...extraida, conta_id, ignorar}]
  const [erro, setErro] = useState(null);
  const [info, setInfo] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    listarContas(empresaId).then((c) => setContas(c.filter((x) => x.aceita_lancamento)));
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
      const [extraidas, historico] = await Promise.all([
        extrairTransacoesDoPDF(arquivo),
        listarLancamentos(empresaId, {}),
      ]);
      const bancoIds = new Set([contaBancoId]);
      const comSugestao = extraidas.map((t) => ({
        ...t,
        conta_id: sugerirConta(t.descricao, historico, { bancoIds }) ?? '',
        ignorar: false,
      }));
      setTransacoes(comSugestao);
    } catch (e) {
      setErro(e.message);
    } finally {
      setProcessando(false);
    }
  }

  function atualizarTransacao(idx, campo, valor) {
    setTransacoes((prev) => prev.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  }

  async function confirmarImportacao() {
    setSalvando(true);
    setErro(null);
    setInfo(null);
    try {
      const contaPendente = contas.find((c) => c.codigo === CODIGO_CONTA_PENDENTE);
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
        // mesmo extrato (ou um período sobreposto) for reimportado depois
        const extratoReferencia = [contaBancoId, t.data, t.tipo, valor.toFixed(2), t.descricao.trim()].join('|');
        return {
          data: t.data,
          historico: t.descricao,
          origem: 'importacao_extrato',
          extratoReferencia,
          conciliado: !!t.conta_id,
          partidas,
        };
      });

      const { criados, pulados } = await criarLancamentosEmLote(empresaId, itens);
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
          <select value={contaBancoId} onChange={(e) => setContaBancoId(e.target.value)}>
            <option value="">Conta bancária do extrato...</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nome}</option>)}
          </select>
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
            <span>Arraste o PDF do extrato aqui, ou <label style={{ color: 'var(--navy2)', cursor: 'pointer', textDecoration: 'underline' }}>
              selecione um arquivo
              <input type="file" accept="application/pdf" style={{ display: 'none' }}
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
          <table className="contabil-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th className="num">Valor</th>
                <th>Conta (contrapartida)</th>
                <th>Ignorar</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, idx) => (
                <tr key={idx}>
                  <td>{new Date(t.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td>{t.descricao}</td>
                  <td className={`num ${t.tipo === 'saida' ? 'valor-negativo' : 'valor-positivo'}`}>
                    R$ {Math.abs(Number(t.valor)).toFixed(2)}
                  </td>
                  <td>
                    <select value={t.conta_id} onChange={(e) => atualizarTransacao(idx, 'conta_id', e.target.value)}>
                      <option value="">A classificar depois</option>
                      {contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nome}</option>)}
                    </select>
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
