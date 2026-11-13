import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  listarLancamentos, idsLancamentosDoFiscal, listarEnviosOneflow, registrarEnvioOneflow,
  desfazerEnvioOneflow, listarLancamentosDoEnvio,
} from './contabilApi';
import {
  montarLinhasOneflow, gerarPlanilhaOneflow, baixarPlanilhaOneflow,
  lerModoOneflow, gravarModoOneflow, nomeArquivoOneflow,
} from './exportarOneflow';
import { separarParaOneflow } from '../../lib/resumoFinanceiro';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const ONEFLOW_URL = 'https://app.omie.com.br/';

// Aba "Lançar no OneFlow": o Gestor é a ponte — gera a planilha oficial do
// OneFlow ("Planilha de Lançamentos — partidas simples") com os lançamentos
// classificados e ainda não enviados, registra o envio e marca os
// lançamentos (supabase-schema-contabil-oneflow-envios.sql). O OneFlow não
// tem API pra receber lançamentos: a importação do arquivo é feita na tela
// dele (Contábil > Lançamentos > Importar lançamentos).
export default function LancarOneflowTab({ empresaId, empresaNome, periodo, onIrPara }) {
  const [dados, setDados] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [modo, setModo] = useState(() => lerModoOneflow(empresaId));
  const [incluirPendentes, setIncluirPendentes] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [confirmandoDesfazer, setConfirmandoDesfazer] = useState(null);

  useEffect(() => { setModo(lerModoOneflow(empresaId)); setIncluirPendentes(false); setAviso(null); }, [empresaId]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [lancamentos, idsDoFiscal, env] = await Promise.all([
        listarLancamentos(empresaId, periodo),
        idsLancamentosDoFiscal(empresaId).catch(() => new Set()),
        listarEnviosOneflow(empresaId).catch((e) => { throw new Error(`Controle de envios indisponível (${e.message}).`); }),
      ]);
      setDados({ lancamentos, idsDoFiscal });
      setEnvios(env);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => (dados ? separarParaOneflow(dados.lancamentos, dados.idsDoFiscal) : null), [dados]);
  const selecionados = useMemo(() => (grupos ? [...grupos.prontos, ...(incluirPendentes ? grupos.bloqueados : [])] : []), [grupos, incluirPendentes]);
  const previa = useMemo(() => montarLinhasOneflow(selecionados, modo), [selecionados, modo]);
  const totalPrevia = useMemo(() => Math.round(previa.linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100, [previa]);
  const bloqueio = previa.fornecedoresSemCnpj.length
    ? `${previa.fornecedoresSemCnpj.length} fornecedor(es) sem CNPJ na conta — ${previa.fornecedoresSemCnpj.slice(0, 5).map((c) => c.nome || c.codigo).join('; ')}. Sem o CNPJ o OneFlow não acha a conta individual do fornecedor.`
    : previa.semConta.length
      ? `${previa.semConta.length} conta(s) sem correspondência no Plano Enxuto — ${previa.semConta.slice(0, 5).map((c) => `${c.codigo} ${c.nome ?? ''}`).join('; ')}. Reclassifique ou escolha "mesmo plano do Gestor".`
      : null;

  async function gerar() {
    if (bloqueio || !previa.linhas.length) return;
    setGerando(true);
    setAviso(null);
    try {
      const arquivo = nomeArquivoOneflow(empresaNome, periodo.dataInicio, periodo.dataFim);
      const wb = gerarPlanilhaOneflow(previa.linhas);
      // registra antes de baixar: arquivo sem registro duplicaria no próximo envio
      await registrarEnvioOneflow(empresaId, {
        lancamentoIds: selecionados.map((l) => l.id),
        dataInicio: periodo.dataInicio, dataFim: periodo.dataFim,
        qtdLinhas: previa.linhas.length, total: totalPrevia, modo, arquivo,
      });
      baixarPlanilhaOneflow(wb, arquivo);
      setAviso({ tipo: 'ok', texto: `Planilha gerada com ${previa.linhas.length} linha(s) (${fmt(totalPrevia)}). Agora importe no OneFlow seguindo os passos abaixo.` });
      await carregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: `Não gerei: ${e.message}` });
    } finally {
      setGerando(false);
    }
  }

  async function baixarDeNovo(envio) {
    setAviso(null);
    try {
      const lancs = await listarLancamentosDoEnvio(envio.id);
      const { linhas } = montarLinhasOneflow(lancs, envio.modo || modo);
      if (!linhas.length) { setAviso({ tipo: 'erro', texto: 'Esse envio não tem mais lançamentos (foram excluídos).' }); return; }
      baixarPlanilhaOneflow(gerarPlanilhaOneflow(linhas), envio.arquivo || nomeArquivoOneflow(empresaNome, envio.data_inicio, envio.data_fim));
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e.message });
    }
  }

  async function desfazer(envio) {
    if (confirmandoDesfazer !== envio.id) { setConfirmandoDesfazer(envio.id); return; }
    setConfirmandoDesfazer(null);
    try {
      await desfazerEnvioOneflow(envio.id);
      setAviso({ tipo: 'ok', texto: 'Envio desfeito: os lançamentos voltaram para "a enviar". Se a planilha já foi importada no OneFlow, exclua os lançamentos lá também.' });
      await carregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e.message });
    }
  }

  const corAviso = aviso?.tipo === 'erro' ? 'var(--danger)' : 'var(--ok)';

  return (
    <div>
      {carregando && !dados && <p>Carregando...</p>}
      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

      {grupos && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="dre-g-kpis">
            <Kpi rotulo="Prontos para lançar" valor={grupos.prontos.length} cor={grupos.prontos.length ? 'var(--accent)' : undefined} sub="classificados e ainda não enviados" />
            <Kpi rotulo="A identificar" valor={grupos.bloqueados.length} cor={grupos.bloqueados.length ? 'var(--warn)' : undefined}
              sub={grupos.bloqueados.length ? 'ficam de fora até classificar' : 'tudo classificado'} />
            <Kpi rotulo="Já lançados no OneFlow" valor={grupos.enviados.length} sub="no período" />
            <Kpi rotulo="Vindos de nota fiscal" valor={grupos.doFiscal.length} sub="o OneFlow já tem pelo Fiscal" />
          </div>

          <div className="dre-g-card fin-card">
            <h3>Gerar arquivo para o OneFlow — {fmtData(periodo.dataInicio)} a {fmtData(periodo.dataFim)}</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={{ fontSize: '0.82rem', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                Plano no OneFlow:
                <select value={modo} onChange={(e) => { setModo(e.target.value); gravarModoOneflow(empresaId, e.target.value); }}>
                  <option value="enxuto">Plano Enxuto</option>
                  <option value="mesmo">Mesmo plano do Gestor</option>
                </select>
              </label>
              {grupos.bloqueados.length > 0 && (
                <label style={{ fontSize: '0.82rem', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={incluirPendentes} onChange={(e) => setIncluirPendentes(e.target.checked)} />
                  Incluir os {grupos.bloqueados.length} em "Valores a Identificar"
                </label>
              )}
              {grupos.bloqueados.length > 0 && onIrPara && (
                <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => onIrPara('lancamentos')}>
                  Identificar pendentes →
                </button>
              )}
            </div>
            {incluirPendentes && (
              <p style={{ fontSize: '0.8rem', color: 'var(--warn)', margin: '0 0 10px' }}>
                No OneFlow a conta "Valores a Identificar" trava o fechamento enquanto tiver saldo. Prefira classificar antes.
              </p>
            )}

            {selecionados.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text2)', margin: 0 }}>
                {grupos.enviados.length ? 'Tudo o que estava classificado no período já foi lançado no OneFlow.' : 'Nenhum lançamento classificado para enviar no período.'}
              </p>
            ) : (
              <>
                {bloqueio && <p style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>Não dá para gerar: {bloqueio}</p>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn-navy" onClick={gerar} disabled={gerando || !!bloqueio || !previa.linhas.length}>
                    {gerando ? 'Gerando...' : `Gerar planilha e marcar ${selecionados.length} como lançado(s)`}
                  </button>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>{previa.linhas.length} linha(s) · {fmt(totalPrevia)}</span>
                </div>
                <div className="contabil-tabela-scroll" style={{ maxHeight: 320, marginTop: 12 }}>
                  <table className="dre-g-tabela fin-tabela">
                    <thead><tr><th style={{ textAlign: 'left' }}>Data</th><th style={{ textAlign: 'left' }}>Débito</th><th style={{ textAlign: 'left' }}>Crédito</th><th style={{ textAlign: 'left' }}>Histórico</th><th className="num">Valor</th></tr></thead>
                    <tbody>
                      {previa.linhas.slice(0, 200).map((l, i) => (
                        <tr key={i}>
                          <td>{fmtData(l.data)}</td><td className="txt">{l.debito}</td><td className="txt">{l.credito}</td><td className="txt">{l.historico}</td><td className="num">{fmt(l.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previa.linhas.length > 200 && <p style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>… mais {previa.linhas.length - 200} linha(s) no arquivo.</p>}
                </div>
              </>
            )}
            {aviso && <p style={{ color: corAviso, fontSize: '0.85rem', margin: '10px 0 0' }}>{aviso.texto}</p>}
          </div>

          <div className="dre-g-card fin-card">
            <h3>Como importar no OneFlow</h3>
            <ol className="fin-passos">
              <li>Abra o <a href={ONEFLOW_URL} target="_blank" rel="noreferrer">OneFlow</a> → módulo <b>Contábil</b> → <b>Abrir Contábil</b> da empresa.</li>
              <li>Menu <b>Incluir</b> → <b>Importar lançamentos</b> → <b>Planilha de Lançamentos</b> (partidas simples).</li>
              <li>Envie o arquivo <b>OneFlow_Lancamentos_….xlsx</b> gerado aqui e confirme.</li>
              <li>Confira em <b>Entradas</b> e siga para conciliação, balancete e DRE no próprio OneFlow.</li>
            </ol>
            <p style={{ fontSize: '0.75rem', color: 'var(--text3)', margin: '8px 0 0' }}>
              Cada lançamento vai uma vez só: os já lançados ficam marcados com “OneFlow ✓” na aba Lançamentos. Se reclassificar um já lançado,
              corrija também no OneFlow. Se a importação lá falhar, use “Desfazer” no envio abaixo e gere de novo.
            </p>
          </div>

          <div className="dre-g-card fin-card">
            <h3>Envios para o OneFlow</h3>
            {envios.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text3)', margin: 0 }}>Nenhum envio ainda.</p> : (
              <table className="dre-g-tabela fin-tabela">
                <thead><tr><th style={{ textAlign: 'left' }}>Gerado em</th><th style={{ textAlign: 'left' }}>Período</th><th className="num">Lançamentos</th><th className="num">Linhas</th><th className="num">Total</th><th /></tr></thead>
                <tbody>
                  {envios.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{fmtData(e.data_inicio)} a {fmtData(e.data_fim)}</td>
                      <td className="num">{e.qtd_lancamentos}</td>
                      <td className="num">{e.qtd_linhas}</td>
                      <td className="num">{fmt(e.total)}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => baixarDeNovo(e)}>Baixar de novo</button>{' '}
                        <button type="button" className={confirmandoDesfazer === e.id ? 'btn-danger' : 'btn-ghost'} style={{ fontSize: '0.75rem' }} onClick={() => desfazer(e)}>
                          {confirmandoDesfazer === e.id ? 'Confirmar desfazer' : 'Desfazer'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, sub, cor }) {
  return (
    <div className="dre-g-kpi">
      <div className="dre-g-kpi-rotulo">{rotulo}</div>
      <div className="dre-g-kpi-valor" style={cor ? { color: cor } : undefined}>{valor}</div>
      {sub && <div className="dre-g-kpi-var">{sub}</div>}
    </div>
  );
}
