import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, cabecalhosFunctions } from '../../lib/supabase';
import { carregarDadosDreGerencialCom, ehDisponivel } from '../../lib/dreGerencial';
import { pendentesDosLancamentos, cruzarComNotas, agruparPorContraparte, contaParaCompraDeNota } from '../../lib/identificarLancamentos';
import { ehContaPendente } from './planoContasConstantes';
import { listarRegrasClassificacao, reclassificarLancamentosEmLote, salvarRegraManual, encontrarRegraAplicavel } from './contabilApi';
import ContaCombobox from './ContaCombobox';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const TAMANHO_LOTE = 30;
const PARALELO = 3;

async function notasDeEntrada(empresaId) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('documentos_fiscais_erp')
      .select('id, numero, razao_social_terceiro, cnpj_cpf_terceiro, data_emissao, valor_total, situacao_documento, tipo_movimento, lancamento_id, dados')
      .eq('cliente_id', empresaId).eq('tipo_movimento', 'entrada').order('data_emissao').range(de, de + 999);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

// Identifica os lançamentos parados em "Valores a Identificar":
// 1) casa saídas com NFs de entrada (valor + data + fornecedor);
// 2) o resto vai pra IA, agrupado por contraparte;
// nada é gravado antes do "Aplicar" — o contador revisa e desmarca o que não quiser.
export default function IdentificarIAModal({ empresaId, empresaNome, periodo, onClose, onAplicado }) {
  const [etapa, setEtapa] = useState('carregando'); // carregando | revisao | aplicando | pronto
  const [erro, setErro] = useState(null);
  const [base, setBase] = useState(null); // { contas, pendentes, notas, regras }
  const [nf, setNf] = useState([]); // [{ marcado, lanc, nota, contaId, motivo }]
  const [grupos, setGrupos] = useState([]); // [{ ...grupo, marcado, contaId, confianca, motivo, criarRegra }]
  const [ia, setIa] = useState({ rodando: false, feitos: 0, total: 0, erros: 0, modelo: null });
  const cancelar = useRef(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [dados, notas, regras] = await Promise.all([
          carregarDadosDreGerencialCom(supabase, empresaId, periodo),
          notasDeEntrada(empresaId),
          listarRegrasClassificacao(empresaId),
        ]);
        const pendentes = pendentesDosLancamentos(dados.lancamentos, dados.contas);
        const notaPorId = new Map(notas.map((n) => [n.id, n]));
        const pendPorId = new Map(pendentes.map((p) => [p.id, p]));
        const casados = cruzarComNotas(pendentes, notas).map((c) => {
          const nota = notaPorId.get(c.notaId);
          const conta = contaParaCompraDeNota(dados.contas, nota, regras, encontrarRegraAplicavel);
          return { marcado: !!conta, lanc: pendPorId.get(c.lancamentoId), nota, contaId: conta?.id ?? '', motivo: c.motivo, score: c.score };
        });
        const gs = agruparPorContraparte(pendentes, { excluirIds: new Set(casados.map((c) => c.lanc.id)), notas })
          .map((g) => {
            // regra já cadastrada vence a IA
            const regra = encontrarRegraAplicavel(g.exemplos[0] ?? g.contraparte, regras);
            const contaRegra = regra && dados.contas.find((c) => c.id === regra.conta_id && !ehContaPendente(c.codigo));
            return { ...g, marcado: !!contaRegra, contaId: contaRegra?.id ?? '', confianca: contaRegra ? 'regra' : null, motivo: contaRegra ? `Regra "${regra.padrao}"` : '', criarRegra: false };
          });
        setBase({ contas: dados.contas, pendentes, notas, regras });
        setNf(casados);
        setGrupos(gs);
        setEtapa('revisao');
      } catch (e) {
        setErro(e.message);
      }
    })();
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  const lancaveis = useMemo(() => (base?.contas ?? []).filter((c) => c.aceita_lancamento && c.ativo !== false
    && !ehDisponivel(c.codigo) && !ehContaPendente(c.codigo)), [base]);
  // plano que vai pra IA: sem contas redutoras "(-)" e sem as sub-contas
  // individuais de fornecedor (o pagamento a fornecedor vai pra compra)
  const planoIA = useMemo(() => lancaveis
    .filter((c) => !c.nome.trim().startsWith('(-)') && !(c.codigo.startsWith('2.1.06.001.') && c.codigo.split('.').length >= 6))
    .map((c) => ({ codigo: c.codigo, nome: c.nome, tipo: c.tipo })), [lancaveis]);
  const contaPorCodigo = useMemo(() => new Map((base?.contas ?? []).map((c) => [c.codigo, c])), [base]);

  async function sugerirComIA() {
    const alvo = grupos.filter((g) => !g.contaId);
    const lotes = [];
    for (let i = 0; i < alvo.length; i += TAMANHO_LOTE) lotes.push(alvo.slice(i, i + TAMANHO_LOTE));
    cancelar.current = false;
    setIa({ rodando: true, feitos: 0, total: lotes.length, erros: 0, modelo: null });
    const contaIdPorCodigo = (cod) => contaPorCodigo.get(cod)?.id ?? '';
    const regrasIA = base.regras.map((r) => ({ padrao: r.padrao, conta_codigo: base.contas.find((c) => c.id === r.conta_id)?.codigo })).filter((r) => r.conta_codigo);
    const headers = { 'content-type': 'application/json', ...(await cabecalhosFunctions()) };
    let proximo = 0;
    async function trabalhador() {
      while (!cancelar.current && proximo < lotes.length) {
        const lote = lotes[proximo++];
        let ok = false;
        for (let tentativa = 0; tentativa < 2 && !ok && !cancelar.current; tentativa++) {
          try {
            const resp = await fetch('/.netlify/functions/identificar-lancamentos', {
              method: 'POST', headers,
              body: JSON.stringify({
                empresaNome, contas: planoIA, regras: regrasIA,
                grupos: lote.map(({ chave, contraparte, natureza, qtd, total, exemplos, fornecedorNf }) => ({ chave, contraparte, natureza, qtd, total, exemplos, fornecedorNf })),
              }),
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(body.error || `Erro ${resp.status}`);
            const porChave = new Map((body.sugestoes ?? []).map((s) => [s.chave, s]));
            setGrupos((gs) => gs.map((g) => {
              const s = porChave.get(g.chave);
              if (!s || g.confianca === 'regra') return g;
              const contaId = contaIdPorCodigo(s.conta_codigo);
              return { ...g, contaId, confianca: s.confianca, motivo: s.motivo, marcado: !!contaId && s.confianca !== 'baixa', criarRegra: !!contaId && s.confianca === 'alta' && g.qtd >= 2 };
            }));
            setIa((x) => ({ ...x, modelo: body.modelo ?? x.modelo }));
            ok = true;
          } catch (e) {
            if (tentativa === 1) { setIa((x) => ({ ...x, erros: x.erros + 1 })); setErro(e.message); }
          }
        }
        setIa((x) => ({ ...x, feitos: x.feitos + 1 }));
      }
    }
    await Promise.all(Array.from({ length: PARALELO }, trabalhador));
    setIa((x) => ({ ...x, rodando: false }));
  }

  async function aplicar() {
    setEtapa('aplicando');
    setErro(null);
    let qtdLanc = 0;
    let qtdRegras = 0;
    try {
      // agrupa por conta: uma atualização em lote por conta escolhida
      const porConta = new Map();
      const add = (contaId, lanc) => {
        if (!porConta.has(contaId)) porConta.set(contaId, { partidas: [], lancs: [] });
        const x = porConta.get(contaId);
        x.partidas.push(lanc.partidaPendenteId);
        x.lancs.push(lanc.id);
      };
      const nfAplicar = nf.filter((x) => x.marcado && x.contaId);
      nfAplicar.forEach((x) => add(x.contaId, x.lanc));
      const gAplicar = grupos.filter((g) => g.marcado && g.contaId);
      gAplicar.forEach((g) => g.lancamentos.forEach((l) => add(g.contaId, l)));
      for (const [contaId, x] of porConta) {
        for (let i = 0; i < x.partidas.length; i += 200) {
          await reclassificarLancamentosEmLote(x.partidas.slice(i, i + 200), x.lancs.slice(i, i + 200), contaId);
        }
        qtdLanc += x.lancs.length;
      }
      // NF fica ligada ao pagamento — evita gerar o lançamento da NF de novo
      for (const x of nfAplicar) {
        await supabase.from('documentos_fiscais_erp').update({ lancamento_id: x.lanc.id }).eq('id', x.nota.id);
      }
      for (const g of gAplicar.filter((g) => g.criarRegra)) {
        try { await salvarRegraManual(empresaId, g.contraparte, g.contaId); qtdRegras += 1; } catch { /* regra é opcional */ }
      }
      setResultado({ qtdLanc, qtdRegras, qtdNf: nfAplicar.length });
      setEtapa('pronto');
      onAplicado?.();
    } catch (e) {
      setErro(e.message);
      setEtapa('revisao');
    }
  }

  const marcadosNf = nf.filter((x) => x.marcado && x.contaId);
  const marcadosG = grupos.filter((g) => g.marcado && g.contaId);
  const qtdAplicar = marcadosNf.length + marcadosG.reduce((s, g) => s + g.qtd, 0);
  const valorAplicar = marcadosNf.reduce((s, x) => s + x.lanc.valor, 0) + marcadosG.reduce((s, g) => s + g.total, 0);
  const semConta = grupos.filter((g) => !g.contaId).length;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,.35)' }} onClick={etapa === 'aplicando' ? undefined : onClose} />
      <div style={{ position: 'fixed', inset: '4vh 3vw', zIndex: 1000, background: 'var(--surface)', borderRadius: 14,
        display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(15,23,42,.3)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: 'var(--navy)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <b>Identificar lançamentos com NFs e IA</b>
            <div style={{ fontSize: 12, color: 'var(--navy-text)' }}>
              {empresaNome} · {fmtData(periodo.dataInicio)} a {fmtData(periodo.dataFim)}
              {base && ` · ${base.pendentes.length} lançamentos em Valores a Identificar · ${base.notas.length} NFs de entrada`}
            </div>
          </div>
          <button type="button" className="btn-ghost" style={{ color: '#fff' }} onClick={onClose} disabled={etapa === 'aplicando'}>Fechar</button>
        </div>

        <div style={{ overflow: 'auto', padding: '14px 20px', flex: 1 }}>
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}
          {etapa === 'carregando' && !erro && <p>Carregando lançamentos e notas fiscais...</p>}
          {etapa === 'pronto' && resultado && (
            <p style={{ color: 'var(--ok)', fontWeight: 600 }}>
              {resultado.qtdLanc} lançamento(s) classificados, {resultado.qtdNf} ligados a NF de entrada, {resultado.qtdRegras} regra(s) criada(s).
              A DRE já considera as novas contas.
            </p>
          )}

          {(etapa === 'revisao' || etapa === 'aplicando') && base && (
            <>
              <h3 style={{ fontSize: '0.95rem', margin: '4px 0 8px' }}>1. Pagamentos que batem com NF de entrada ({nf.length})</h3>
              {nf.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Nenhuma saída casou com NF de entrada no período.</p> : (
                <table className="contabil-tabela" style={{ width: '100%', marginBottom: 18 }}>
                  <thead><tr><th /><th>Data</th><th>Histórico</th><th style={{ textAlign: 'right' }}>Valor</th><th>Nota fiscal</th><th>Conta</th></tr></thead>
                  <tbody>
                    {nf.map((x, i) => (
                      <tr key={x.lanc.id}>
                        <td><input type="checkbox" checked={x.marcado} onChange={(e) => setNf((a) => a.map((y, j) => (j === i ? { ...y, marcado: e.target.checked } : y)))} /></td>
                        <td>{fmtData(x.lanc.data)}</td>
                        <td>{x.lanc.historico}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{fmt(x.lanc.valor)}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>{x.motivo}</td>
                        <td style={{ minWidth: 240 }}>
                          <ContaCombobox contas={lancaveis} value={x.contaId} onChange={(id) => setNf((a) => a.map((y, j) => (j === i ? { ...y, contaId: id, marcado: true } : y)))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '6px 0 8px' }}>
                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>2. Demais lançamentos por contraparte ({grupos.length})</h3>
                {!ia.rodando ? (
                  <button type="button" className="btn-navy" onClick={sugerirComIA} disabled={semConta === 0 || etapa === 'aplicando'}>
                    Sugerir contas com IA ({semConta} contrapartes)
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>IA analisando... lote {ia.feitos} de {ia.total}{ia.erros ? ` · ${ia.erros} com erro` : ''}</span>
                    <button type="button" className="btn-ghost" onClick={() => { cancelar.current = true; }}>Parar</button>
                  </>
                )}
                {ia.modelo && !ia.rodando && <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Sugestões de {ia.modelo} — revise antes de aplicar.</span>}
              </div>
              <table className="contabil-tabela" style={{ width: '100%' }}>
                <thead><tr><th /><th>Contraparte</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Qtd</th><th style={{ textAlign: 'right' }}>Total</th><th>Conta sugerida</th><th>Motivo</th><th>Regra</th></tr></thead>
                <tbody>
                  {grupos.map((g, i) => (
                    <tr key={g.chave}>
                      <td><input type="checkbox" checked={g.marcado} disabled={!g.contaId} onChange={(e) => setGrupos((a) => a.map((y, j) => (j === i ? { ...y, marcado: e.target.checked } : y)))} /></td>
                      <td>
                        {g.contraparte}
                        {g.fornecedorNf && <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--accent)' }}>fornecedor com {g.fornecedorNf.qtdNotas} NF(s) de entrada</span>}
                      </td>
                      <td>{g.natureza === 'saida' ? 'Saída' : 'Entrada'}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{g.qtd}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{fmt(g.total)}</td>
                      <td style={{ minWidth: 260 }}>
                        <ContaCombobox contas={lancaveis} value={g.contaId} placeholder="Escolher conta..."
                          onChange={(id) => setGrupos((a) => a.map((y, j) => (j === i ? { ...y, contaId: id, marcado: true, confianca: y.confianca ?? 'manual' } : y)))} />
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text2)', maxWidth: 320 }}>
                        {g.confianca && g.confianca !== 'manual' && (
                          <b style={{ color: g.confianca === 'alta' || g.confianca === 'regra' ? 'var(--ok)' : g.confianca === 'media' ? 'var(--warn)' : 'var(--danger)' }}>
                            {g.confianca === 'regra' ? 'regra' : `confiança ${g.confianca === 'media' ? 'média' : g.confianca}`}:{' '}
                          </b>
                        )}
                        {g.motivo}
                      </td>
                      <td><input type="checkbox" title="Criar regra para os próximos extratos" checked={g.criarRegra} disabled={!g.contaId || g.confianca === 'regra'}
                        onChange={(e) => setGrupos((a) => a.map((y, j) => (j === i ? { ...y, criarRegra: e.target.checked } : y)))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {(etapa === 'revisao' || etapa === 'aplicando') && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>{qtdAplicar} lançamento(s) marcados · {fmt(valorAplicar)}</span>
            <button type="button" className="btn-navy" onClick={aplicar} disabled={qtdAplicar === 0 || ia.rodando || etapa === 'aplicando'}>
              {etapa === 'aplicando' ? 'Aplicando...' : 'Aplicar classificação'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
