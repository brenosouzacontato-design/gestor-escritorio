// Link "todas as notas" do cliente: ?notas=<token do painel>
// No topo, as notas que o escritório ainda vai emitir (painel-nfse.js 'pendentes'): o cliente
// completa o que falta e confirma as complementares. Abaixo, todas as NFS-e emitidas pela empresa
// (inclusive fora do gestor), lidas do Ambiente Nacional, com busca e filtro por ano/mês, PDF (DANFSe
// com QR Code de validação), XML e envio do PDF pelo WhatsApp. Ver netlify/functions/nfse-emitidas.js.
import { useEffect, useMemo, useState } from 'react';
import { CalendarIcon, FileTextIcon, SearchIcon, SendIcon, RefreshCwIcon, AlertTriangleIcon } from 'lucide-react';
import AcessoPainel from './AcessoPainel';
import { numeroWhatsapp, listarNfsePendentes, completarNfse } from './nfsePainelApi';
import LinhaNfsePendente, { valorAEmitir, COLUNAS_LINHA, fmtDoc, Pilula } from './NfsePendenteLinha';
import { listarTodasNfse, baixarNfseEmitida, linkPdfNfseEmitida } from './nfseEmitidasApi';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SITUACAO = {
  cancelada: { rotulo: 'Cancelada', cor: 'var(--danger)' },
  substituida: { rotulo: 'Substituída', cor: 'var(--warn)' },
};
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Computador (≥ 900px): uma linha inteira por paciente, em colunas; celular: cartão empilhado
function useLargo() {
  const consulta = '(min-width: 900px)';
  const [largo, setLargo] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const mudou = () => setLargo(mq.matches);
    mq.addEventListener('change', mudou);
    return () => mq.removeEventListener('change', mudou);
  }, []);
  return largo;
}

// Tabela no estilo do Microsoft Lists: um bloco com cabeçalho, linhas separadas por um fio e
// destaque ao passar o mouse
const ESTILO_TABELA = `
.lista-tabela { border: 1px solid var(--border); border-radius: var(--r-md, 10px); overflow: hidden; background: var(--surface, var(--bg)); }
.lista-tabela > * + * { border-top: 1px solid var(--border); }
.lista-tabela .linha-lista { transition: background .12s; }
.lista-tabela .linha-lista:hover { background: color-mix(in srgb, var(--text1) 4%, transparent); }
`;

function Cabecalho({ colunas }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLUNAS_LINHA, gap: 12, padding: '8px 14px', fontSize: 10, fontWeight: 700,
      color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', background: 'color-mix(in srgb, var(--text1) 3%, transparent)' }}>
      {colunas.map((c, i) => <span key={c} style={{ textAlign: i === 3 ? 'right' : 'left' }}>{c}</span>)}
    </div>
  );
}

export default function NotasEmitidasPage({ token }) {
  return (
    <AcessoPainel valor={token}>
      {(sessao) => <NotasEmitidas clienteId={sessao.id} nomeSessao={sessao.nome} />}
    </AcessoPainel>
  );
}

function NotasEmitidas({ clienteId, nomeSessao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [ano, setAno] = useState('todos');
  const [mes, setMes] = useState('todos');
  const [verCanceladas, setVerCanceladas] = useState(false);
  const [pendentes, setPendentes] = useState([]);
  const largo = useLargo();

  useEffect(() => {
    let ativo = true;
    listarTodasNfse(clienteId).then((d) => ativo && setDados(d)).catch((e) => ativo && setErro(e.message));
    listarNfsePendentes(clienteId).then((p) => ativo && setPendentes(p)).catch(() => ativo && setPendentes([]));
    return () => { ativo = false; };
  }, [clienteId]);

  const completar = async (nota, campos) => {
    const salva = await completarNfse(clienteId, nota.id, campos);
    setPendentes((lista) => lista.map((n) => (n.id === salva.id ? salva : n)));
  };

  const notas = dados?.notas || [];
  const anos = useMemo(() => [...new Set([...notas.map((n) => n.competencia?.slice(3)), ...pendentes.map((n) => n.data?.slice(0, 4))].filter(Boolean))].sort().reverse(), [notas, pendentes]);
  // Os mesmos filtros valem para as notas a emitir (pela data do atendimento)
  const pendentesFiltradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return pendentes.filter((n) => {
      if (ano !== 'todos' && n.data?.slice(0, 4) !== ano) return false;
      if (mes !== 'todos' && n.data?.slice(5, 7) !== mes) return false;
      if (!termo) return true;
      return [n.nome, n.descricao, fmt(n.valor)].some((c) => semAcento(c).includes(termo));
    });
  }, [pendentes, busca, ano, mes]);
  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return notas.filter((n) => {
      if (!verCanceladas && n.situacao !== 'autorizada') return false;
      if (ano !== 'todos' && n.competencia?.slice(3) !== ano) return false;
      if (mes !== 'todos' && n.competencia?.slice(0, 2) !== mes) return false;
      if (!termo) return true;
      return [n.numero, n.tomador, n.descricao, fmt(n.valor)].some((c) => semAcento(c).includes(termo));
    });
  }, [notas, busca, ano, mes, verCanceladas]);
  const canceladas = notas.filter((n) => n.situacao !== 'autorizada').length;
  const autorizadas = filtradas.filter((n) => n.situacao === 'autorizada');
  const total = autorizadas.reduce((t, n) => t + Number(n.valor || 0), 0);
  const aEmitir = pendentesFiltradas.filter((n) => valorAEmitir(n) > 0);
  const totalAEmitir = aEmitir.reduce((t, n) => t + valorAEmitir(n), 0);
  const faltaInfo = aEmitir.filter((n) => ['falta', 'invalida'].includes(situacaoDe(n))).length;

  // agrupa por competência (mais recente primeiro)
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const n of filtradas) {
      const k = n.competencia || 'sem';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(n);
    }
    const chave = (k) => (k === 'sem' ? '0' : `${k.slice(3)}${k.slice(0, 2)}`);
    return [...mapa.entries()].sort((a, b) => chave(b[0]).localeCompare(chave(a[0])));
  }, [filtradas]);

  const baixar = async (n, formato) => {
    try { await baixarNfseEmitida(clienteId, n, formato); } catch (e) { window.alert(e.message); }
  };
  const enviarWhatsapp = async (n, numero) => {
    const aba = window.open('', '_blank'); // abre já no clique, antes do await (bloqueio de pop-up)
    try {
      const { url } = await linkPdfNfseEmitida(clienteId, n.id);
      const texto = `Olá${n.tomador ? `, ${n.tomador.split(' ')[0]}` : ''}! Segue a nota fiscal de serviço nº ${n.numero || ''}`
        + `${n.valor != null ? ` (${fmt(n.valor)})` : ''}: ${url}`;
      const destino = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
      if (aba) aba.location.href = destino; else window.location.href = destino;
    } catch (e) {
      if (aba) aba.close();
      window.alert(e.message);
    }
  };

  const campo = { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)', fontFamily: 'inherit' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text1)' }}>
      <style>{ESTILO_TABELA}</style>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 16px 48px' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Notas fiscais de serviço emitidas</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px' }}>{dados?.empresa || nomeSessao || 'Empresa'}</h1>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Todas as notas registradas no Sistema Nacional da NFS-e{dados?.sincronizadoEm ? ` · atualizado em ${new Date(dados.sincronizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
        </div>

        {erro && <Aviso>{erro}</Aviso>}
        {dados?.erro && <Aviso>{dados.erro}</Aviso>}
        {!dados && !erro && <div style={{ marginTop: 32, fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCwIcon size={14} /> Buscando as notas…</div>}

        {(dados || pendentes.length > 0) && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '12px 0 10px', margin: '6px 0 0',
            display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
            <label style={{ ...campo, flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
              <SearchIcon size={14} style={{ color: 'var(--text3)' }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por paciente, valor, serviço ou número"
                aria-label="Buscar notas" style={{ border: 'none', outline: 'none', background: 'transparent', color: 'inherit', fontSize: 13, padding: '8px 0', flex: 1, minWidth: 0, fontFamily: 'inherit' }} />
            </label>
            <select value={ano} onChange={(e) => setAno(e.target.value)} aria-label="Ano" style={{ ...campo, flex: '0 1 150px' }}>
              <option value="todos">Todos os anos</option>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês" style={{ ...campo, flex: '0 1 160px' }}>
              <option value="todos">Todos os meses</option>
              {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
          </div>
        )}

        {(dados || pendentes.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginTop: 14 }}>
            <CardValor titulo="Notas emitidas" valor={dados ? fmt(total) : '…'} cor="var(--ok)"
              detalhe={dados ? `${autorizadas.length} nota${autorizadas.length !== 1 ? 's' : ''}` : 'Buscando…'} />
            <CardValor titulo="Valor a emitir" valor={fmt(totalAEmitir)} cor="var(--warn)"
              detalhe={`${aEmitir.length} nota${aEmitir.length !== 1 ? 's' : ''}${faltaInfo ? ` · ${faltaInfo} com informação faltando` : ''}`} />
          </div>
        )}

        {pendentes.length > 0 && <NotasAEmitir pendentes={pendentesFiltradas} total={pendentes.length} onSalvar={completar} largo={largo} />}

        {dados && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', margin: '28px 0 10px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, flex: 1 }}>
                Notas emitidas <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                  {filtradas.length}{filtradas.length !== notas.length ? ` de ${notas.length}` : ''}
                </span>
              </h2>
              {canceladas > 0 && (
                <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} />
                  Mostrar canceladas/substituídas ({canceladas})
                </label>
              )}
            </div>

            {notas.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhuma nota emitida encontrada no Sistema Nacional.</div>}
            {notas.length > 0 && filtradas.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhuma nota com esses filtros.</div>}

            {filtradas.length > 0 && (
              <div className="lista-tabela">
                {largo && <Cabecalho colunas={['Nota e paciente', 'Datas', 'Serviço', 'Valor', 'Arquivos']} />}
                {grupos.map(([competencia, lista]) => [
                  <div key={`g-${competencia}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 14px', fontSize: 12, fontWeight: 700,
                    color: 'var(--text2)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>
                    <span>{competencia === 'sem' ? 'Sem competência' : `${MESES[Number(competencia.slice(0, 2)) - 1]} de ${competencia.slice(3)}`}</span>
                    <span style={{ color: 'var(--text3)', fontWeight: 600 }}>{lista.length} · {fmt(lista.filter((n) => n.situacao === 'autorizada').reduce((t, n) => t + Number(n.valor || 0), 0))}</span>
                  </div>,
                  ...lista.map((n) => <LinhaNota key={n.id} n={n} onBaixar={baixar} onWhatsapp={enviarWhatsapp} largo={largo} />),
                ])}
              </div>
            )}

            <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 28, lineHeight: 1.5 }}>
              O PDF é o DANFSe (documento auxiliar). A validade pode ser conferida pelo QR Code do PDF ou pela chave de acesso no portal nacional
              (nfse.gov.br). O XML é o documento fiscal com validade jurídica.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Ordem: o que depende do cliente primeiro, depois o que o escritório vai emitir, por fim as que já
// tinham sido emitidas
const ORDEM = { falta: 0, invalida: 0, complementar: 1, pronta: 2, ja_emitida: 3 };
const situacaoDe = (n) => n.situacao || (n.pronta ? 'pronta' : n.erros.length ? 'invalida' : 'falta');

function CardValor({ titulo, valor, detalhe, cor }) {
  return (
    <div style={{ padding: '12px 16px', background: 'var(--surface, var(--bg))', border: '1px solid var(--border)', borderRadius: 'var(--r-md, 10px)',
      borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: '2px 0', fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{detalhe}</div>
    </div>
  );
}

function NotasAEmitir({ pendentes, total, onSalvar, largo }) {
  const conta = (...s) => pendentes.filter((n) => s.includes(situacaoDe(n))).length;
  const lista = [...pendentes].sort((a, b) => ORDEM[situacaoDe(a)] - ORDEM[situacaoDe(b)] || String(a.data || '').localeCompare(String(b.data || '')));
  const resumo = [
    [conta('falta', 'invalida'), ['precisa de informação', 'precisam de informação'], 'var(--warn)'],
    [conta('complementar'), ['possível complementar', 'possíveis complementares'], 'var(--info)'],
    [conta('pronta'), ['pronta para emitir', 'prontas para emitir'], 'var(--ok)'],
    [conta('ja_emitida'), ['já emitida antes', 'já emitidas antes'], 'var(--text3)'],
  ].filter(([q]) => q > 0);
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Notas a emitir</h2>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
        Atendimentos enviados ao escritório que ainda não viraram nota.
        Complete o que falta aqui mesmo; o escritório emite assim que estiver tudo certo.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {resumo.map(([q, [um, varios], cor]) => (
          <span key={um} style={{ fontSize: 11, fontWeight: 700, color: cor, border: `1px solid ${cor}`, borderRadius: 99, padding: '3px 10px' }}>{q} {q === 1 ? um : varios}</span>
        ))}
      </div>
      {pendentes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhuma das {total} notas a emitir com esses filtros.</div>}
      {pendentes.length > 0 && (
        <div className="lista-tabela">
          {largo && <Cabecalho colunas={['Paciente', 'Data', 'Serviço e endereço', 'Valor', 'Situação']} />}
          {lista.map((n) => <LinhaNfsePendente key={n.id} n={n} onSalvar={onSalvar} largo={largo} emTabela />)}
        </div>
      )}
    </section>
  );
}

function Aviso({ children }) {
  return (
    <div style={{ marginTop: 14, fontSize: 12, color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <AlertTriangleIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{children}</span>
    </div>
  );
}

function LinhaNota({ n, onBaixar, onWhatsapp, largo }) {
  const [enviando, setEnviando] = useState(false);
  const [numero, setNumero] = useState('');
  const destino = numeroWhatsapp(numero);
  const especial = SITUACAO[n.situacao];
  const botao = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' };
  const enviar = () => { if (destino) { onWhatsapp(n, destino); setEnviando(false); setNumero(''); } };
  return (
    <div className="linha-lista" style={{ padding: '10px 14px', opacity: especial ? 0.7 : 1 }}>
      {largo ? (
        <div style={{ display: 'grid', gridTemplateColumns: COLUNAS_LINHA, gap: 12, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>NFS-e nº {n.numero || '—'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text1)' }}>{n.tomador || 'Tomador não informado'}</div>
            {n.tomadorDoc && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{String(n.tomadorDoc).replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF'} {fmtDoc(n.tomadorDoc)}</div>}
            {especial && <div style={{ marginTop: 3 }}><Pilula cor={especial.cor}>{especial.rotulo}</Pilula></div>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.5 }}>
            {n.emitidaEm && <div>Emitida em {fmtData(n.emitidaEm)}</div>}
            {n.competencia && <div style={{ color: 'var(--text3)' }}>Competência {n.competencia}</div>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', minWidth: 0, overflowWrap: 'anywhere' }}>{n.descricao || '—'}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 800, textDecoration: especial ? 'line-through' : 'none' }}>{n.valor != null ? fmt(n.valor) : '—'}</div>
            {n.valorLiquido != null && Number(n.valorLiquido) !== Number(n.valor) && <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>líquido {fmt(n.valorLiquido)}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onBaixar(n, 'pdf')} style={{ ...botao, color: 'var(--accent)', background: 'var(--accent-dim)', border: 'none' }}>
              <FileTextIcon size={11} /> PDF
            </button>
            <button type="button" onClick={() => onBaixar(n, 'xml')} style={{ ...botao, color: 'var(--accent)', background: 'var(--accent-dim)', border: 'none' }}>XML</button>
            {!especial && (
              <button type="button" onClick={() => setEnviando((v) => !v)} title="Enviar o PDF pelo WhatsApp"
                style={{ ...botao, color: '#fff', background: '#25D366', border: 'none' }}>
                <SendIcon size={11} /> WhatsApp
              </button>
            )}
          </div>
        </div>
      ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            NFS-e nº {n.numero || '—'}{n.tomador ? ` — ${n.tomador}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
            {n.emitidaEm && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><CalendarIcon size={10} /> Emitida em {fmtData(n.emitidaEm)}</span>}
            {n.competencia && <span>Competência {n.competencia}</span>}
            {n.tomadorDoc && <span>{String(n.tomadorDoc).replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF'} {fmtDoc(n.tomadorDoc)}</span>}
            {especial && <Pilula cor={especial.cor}>{especial.rotulo}</Pilula>}
          </div>
          {n.descricao && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2, overflowWrap: 'anywhere' }}>{n.descricao}</div>}
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', textDecoration: especial ? 'line-through' : 'none' }}>{n.valor != null ? fmt(n.valor) : '—'}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => onBaixar(n, 'pdf')} style={{ ...botao, color: 'var(--accent)', background: 'var(--accent-dim)', border: 'none' }}>
            <FileTextIcon size={11} /> PDF
          </button>
          <button type="button" onClick={() => onBaixar(n, 'xml')} style={{ ...botao, color: 'var(--accent)', background: 'var(--accent-dim)', border: 'none' }}>XML</button>
          {!especial && (
            <button type="button" onClick={() => setEnviando((v) => !v)} title="Enviar o PDF pelo WhatsApp"
              style={{ ...botao, color: '#fff', background: '#25D366', border: 'none' }}>
              <SendIcon size={11} /> WhatsApp
            </button>
          )}
        </div>
      </div>
      )}
      {enviando && (
        <form onSubmit={(e) => { e.preventDefault(); enviar(); }} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <input autoFocus type="tel" inputMode="tel" placeholder="WhatsApp do paciente, ex: (31) 99999-9999" value={numero}
            onChange={(e) => setNumero(e.target.value)} aria-label="Número do WhatsApp"
            style={{ flex: '1 1 220px', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)' }} />
          <button type="submit" disabled={!destino}
            style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: destino ? '#25D366' : 'var(--text3)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: destino ? 'pointer' : 'default' }}>
            Abrir no WhatsApp
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--text3)', flexBasis: '100%' }}>
            Vai uma mensagem com o link do PDF (vale por 30 dias). Você confere e envia no WhatsApp.
          </span>
        </form>
      )}
    </div>
  );
}
