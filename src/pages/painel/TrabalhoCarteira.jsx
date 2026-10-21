import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckIcon, CalendarIcon, PlusIcon, ClipboardListIcon, CheckSquareIcon, AlertTriangleIcon, ClockIcon, CheckCircleIcon,
  SearchIcon, RotateCcwIcon, Building2Icon, XIcon, Loader2Icon,
} from 'lucide-react';
import { BotaoAnexos, AnexosItemModal } from '../../components/AnexosItem';
import {
  listarItensCarteira, mudarStatusObrigacaoCarteira, concluirTarefaCarteira, criarTarefaCarteira,
  anexarArquivoCarteira, abrirAnexoCarteira,
} from './carteiraApi';

// Tarefas e obrigações das empresas da carteira, no link da carteira
// (PainelCarteiraPage.jsx), sem login — tudo pela function carteira-acao, que
// confere o token e a empresa. Dois jeitos de ver:
//   - <TrabalhoEmpresaCarteira>: uma empresa, igual ao modal de Empresas.jsx
//     (obrigações e tarefas em "A entregar" x "Entregue"), com baixa, anexos e
//     nova tarefa;
//   - <QuadroCarteira>: todas as empresas, em colunas Vencidas / A vencer /
//     Concluídas, embaixo dos cards da carteira.

const STATUS_OBS = ['pendente', 'concluido', 'nao_aplica', 'vencido'];
const STATUS_LABEL = { pendente: 'Pendente', concluido: 'Concluída', nao_aplica: 'Não se aplica', vencido: 'Vencida' };
const STATUS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'], concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'], vencido: ['var(--danger)', 'var(--danger-dim)'],
};
const DEPARTAMENTOS = ['fiscal', 'folha', 'societario', 'contabil', 'escritorio', 'geral', 'pessoal'];

const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '');
const normalizar = (t) => (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtData = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '');

// Obrigação e tarefa no mesmo formato, pra listar juntas. `anterior` marca
// obrigação em aberto de competência passada — ficam escondidas até pedir
// (na prática muitas nunca foram baixadas no sistema e soterrariam o quadro).
function normalizarItens(dados, competencia) {
  const hoje = hojeIso();
  const anexosPor = (tipo, id) => dados.anexos.filter((a) => (tipo === 'obrigacao' ? a.obrigacao_id : a.tarefa_id) === id);
  const obrigacoes = dados.obrigacoes.map((o) => {
    const concluido = o.status === 'concluido' || o.status === 'nao_aplica';
    return {
      tipo: 'obrigacao', id: o.id, clienteId: o.cliente_id, titulo: o.titulo || o.tipo || 'Obrigação', vencimento: o.vencimento,
      concluido, vencido: !concluido && (o.status === 'vencido' || (!!o.vencimento && o.vencimento < hoje)),
      status: o.status || 'pendente', modulo: o.departamentos ? `${o.departamentos.icone || ''} ${o.departamentos.nome}`.trim() : null,
      competencia: o.competencia, quando: o.updated_at, anexos: anexosPor('obrigacao', o.id), original: o,
      anterior: !!competencia && o.competencia !== competencia,
    };
  });
  const tarefas = dados.tarefas.map((t) => ({
    tipo: 'tarefa', id: t.id, clienteId: t.cliente_id, titulo: t.titulo, vencimento: t.vencimento,
    concluido: !!t.concluida, vencido: !t.concluida && !!t.vencimento && t.vencimento < hoje,
    modulo: t.departamento ? t.departamento.charAt(0).toUpperCase() + t.departamento.slice(1) : null,
    prioridade: t.prioridade, quando: t.concluida_em, anexos: anexosPor('tarefa', t.id), original: t,
  }));
  return [...obrigacoes, ...tarefas];
}

// Carrega os itens da carteira e expõe as ações (cada uma recarrega a lista)
export function useTrabalhoCarteira(token, competencia) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null); // id do item sendo salvo

  const recarregar = useCallback(() => listarItensCarteira(token, competencia)
    .then((d) => { setDados(d); setErro(null); })
    .catch((e) => setErro(e.message)), [token, competencia]);
  useEffect(() => { setDados(null); recarregar(); }, [recarregar]);

  const executar = async (id, fn) => {
    setOcupado(id);
    try { await fn(); await recarregar(); } catch (e) { window.alert(e.message); }
    setOcupado(null);
  };
  const acoes = {
    mudarStatus: (item, status) => executar(item.id, () => mudarStatusObrigacaoCarteira(token, item.id, status)),
    alternarConcluido: (item) => executar(item.id, () => (item.tipo === 'obrigacao'
      ? mudarStatusObrigacaoCarteira(token, item.id, item.concluido ? 'pendente' : 'concluido')
      : concluirTarefaCarteira(token, item.id, !item.concluido))),
    criarTarefa: async (tarefa) => { await criarTarefaCarteira(token, tarefa); await recarregar(); },
    anexar: async (item, arquivo, opcoes) => { await anexarArquivoCarteira(token, { tipo: item.tipo, id: item.id }, arquivo, opcoes); await recarregar(); },
    abrirAnexo: (anexo) => abrirAnexoCarteira(token, anexo.id).catch((e) => window.alert(e.message)),
  };
  const [verAnteriores, setVerAnteriores] = useState(false);
  const todos = useMemo(() => (dados ? normalizarItens(dados, competencia) : []), [dados, competencia]);
  const itens = useMemo(() => (verAnteriores ? todos : todos.filter((i) => !i.anterior)), [todos, verAnteriores]);
  const qtdAnteriores = todos.filter((i) => i.anterior).length;
  return { dados, todos, itens, erro, ocupado, acoes, recarregar, verAnteriores, setVerAnteriores, qtdAnteriores };
}

// Botão que mostra/esconde as obrigações em aberto de meses anteriores
// (da carteira toda, ou só de uma empresa)
function BotaoAnteriores({ trabalho, clienteId }) {
  const qtd = clienteId
    ? trabalho.todos.filter((i) => i.anterior && i.clienteId === clienteId).length
    : trabalho.qtdAnteriores;
  if (!qtd) return null;
  return (
    <button type="button" onClick={() => trabalho.setVerAnteriores(!trabalho.verAnteriores)}
      title="Obrigações de competências passadas que ainda estão como pendentes no sistema"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: '4px 10px', cursor: 'pointer',
        border: `1px solid ${trabalho.verAnteriores ? 'var(--danger)' : 'var(--border)'}`,
        background: trabalho.verAnteriores ? 'var(--danger-dim)' : 'var(--surface)', color: trabalho.verAnteriores ? 'var(--danger)' : 'var(--text2)' }}>
      <AlertTriangleIcon size={12} />
      {trabalho.verAnteriores ? 'Esconder meses anteriores' : `+ ${qtd} de meses anteriores em aberto`}
    </button>
  );
}

// ---------- uma empresa ----------

export function TrabalhoEmpresaCarteira({ trabalho, empresa }) {
  const { itens, erro, dados, ocupado, acoes } = trabalho;
  const [anexoItem, setAnexoItem] = useState(null);
  const [novaTarefa, setNovaTarefa] = useState(false);
  if (erro) return <Aviso>{erro}</Aviso>;
  if (!dados) return <Aviso>Carregando tarefas e obrigações...</Aviso>;

  const daEmpresa = itens.filter((i) => i.clienteId === empresa.id);
  const secao = (tipo) => {
    const lista = daEmpresa.filter((i) => i.tipo === tipo)
      .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
    return { aEntregar: lista.filter((i) => !i.concluido), entregues: lista.filter((i) => i.concluido) };
  };
  const obs = secao('obrigacao');
  const tar = secao('tarefa');
  const itemAnexo = anexoItem && itens.find((i) => i.id === anexoItem.id && i.tipo === anexoItem.tipo);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '14px 12px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SecaoItens icone={<ClipboardListIcon size={14} />} titulo="Obrigações" {...obs}
        extra={<BotaoAnteriores trabalho={trabalho} clienteId={empresa.id} />}
        render={(i) => <CardItem key={i.id} item={i} ocupado={ocupado === i.id} acoes={acoes} onAnexos={() => setAnexoItem(i)} />} />
      <SecaoItens icone={<CheckSquareIcon size={14} />} titulo="Tarefas" {...tar}
        extra={<button type="button" className="btn btn-accent" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setNovaTarefa(true)}><PlusIcon size={13} /> Nova tarefa</button>}
        render={(i) => <CardItem key={i.id} item={i} ocupado={ocupado === i.id} acoes={acoes} onAnexos={() => setAnexoItem(i)} />} />

      {itemAnexo && (
        <ModalAnexos item={itemAnexo} empresa={empresa} acoes={acoes} onClose={() => setAnexoItem(null)} />
      )}
      {novaTarefa && (
        <NovaTarefaModal empresa={empresa} onClose={() => setNovaTarefa(false)}
          onSalvar={async (t) => { await acoes.criarTarefa({ ...t, clienteId: empresa.id }); setNovaTarefa(false); }} />
      )}
    </div>
  );
}

function SecaoItens({ icone, titulo, aEntregar, entregues, render, extra }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {icone} {titulo} <span style={{ color: 'var(--text2)' }}>({aEntregar.length + entregues.length})</span>
        </div>
        {extra}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <Coluna titulo="A entregar" qtd={aEntregar.length} cor="var(--warn)" vazio="Nada pendente">{aEntregar.map(render)}</Coluna>
        <Coluna titulo="Entregue" qtd={entregues.length} cor="var(--ok)" vazio="Nada entregue ainda">{entregues.map(render)}</Coluna>
      </div>
    </section>
  );
}

// ---------- todas as empresas, em colunas ----------

export function QuadroCarteira({ trabalho, competencia, onAbrirEmpresa }) {
  const { itens, erro, dados, ocupado, acoes } = trabalho;
  const [tipo, setTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [anexoItem, setAnexoItem] = useState(null);

  const empresasPorId = useMemo(() => new Map((dados?.empresas || []).map((e) => [e.id, e])), [dados]);
  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return itens
      .filter((i) => tipo === 'todos' || i.tipo === tipo)
      .filter((i) => !termo || normalizar(`${i.titulo} ${empresasPorId.get(i.clienteId)?.nome || ''}`).includes(termo));
  }, [itens, tipo, busca, empresasPorId]);

  if (erro) return <Aviso>{erro}</Aviso>;
  if (!dados) return <Aviso>Carregando tarefas e obrigações da carteira...</Aviso>;

  const porVencimento = (a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999');
  const colunas = [
    { id: 'vencidas', titulo: 'Vencidas', cor: 'var(--danger)', Icone: AlertTriangleIcon, itens: filtrados.filter((i) => i.vencido).sort(porVencimento) },
    { id: 'a_vencer', titulo: 'A vencer', cor: 'var(--warn)', Icone: ClockIcon, itens: filtrados.filter((i) => !i.concluido && !i.vencido).sort(porVencimento) },
    { id: 'concluidas', titulo: 'Concluídas', cor: 'var(--ok)', Icone: CheckCircleIcon, itens: filtrados.filter((i) => i.concluido).sort((a, b) => (b.quando || '').localeCompare(a.quando || '')) },
  ];
  const itemAnexo = anexoItem && itens.find((i) => i.id === anexoItem.id && i.tipo === anexoItem.tipo);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text1)' }}>Tarefas e obrigações da carteira</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Obrigações de {competencia} · tarefas em aberto e concluídas nos últimos 45 dias</div>
        </div>
        <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
          {[['todos', 'Todos'], ['obrigacao', 'Obrigações'], ['tarefa', 'Tarefas']].map(([v, label]) => (
            <button key={v} type="button" onClick={() => setTipo(v)}
              style={{ border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: tipo === v ? 'var(--navy)' : 'transparent', color: tipo === v ? '#fff' : 'var(--text2)' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
        <SearchIcon size={14} color="var(--text3)" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por empresa ou tarefa/obrigação..."
          style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13.5, padding: 0, width: '100%', color: 'var(--text1)' }} />
      </div>
      <div><BotaoAnteriores trabalho={trabalho} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, alignItems: 'start' }}>
        {colunas.map((c) => (
          <Coluna key={c.id} titulo={c.titulo} qtd={c.itens.length} cor={c.cor} Icone={c.Icone} destaque
            vazio={c.id === 'vencidas' ? 'Nada vencido 🎉' : c.id === 'a_vencer' ? 'Nada pendente' : 'Nada concluído ainda'}>
            {c.itens.map((i) => (
              <CardItem key={`${i.tipo}-${i.id}`} item={i} empresa={empresasPorId.get(i.clienteId)} compacto
                ocupado={ocupado === i.id} acoes={acoes} onAnexos={() => setAnexoItem(i)} onAbrirEmpresa={onAbrirEmpresa} />
            ))}
          </Coluna>
        ))}
      </div>
      {itemAnexo && (
        <ModalAnexos item={itemAnexo} empresa={empresasPorId.get(itemAnexo.clienteId)} acoes={acoes} onClose={() => setAnexoItem(null)} />
      )}
    </div>
  );
}

// ---------- peças ----------

function Coluna({ titulo, qtd, cor, Icone, vazio, destaque, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0,
      ...(destaque ? { background: 'var(--surface2)', border: '1px solid var(--border)', borderTop: `3px solid ${cor}`, borderRadius: 'var(--r-md)', padding: 8 } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {Icone && <Icone size={13} />} {titulo}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, borderRadius: 99, padding: '1px 8px', background: 'var(--surface)', color: cor }}>{qtd}</span>
      </div>
      {qtd === 0 && <div style={{ fontSize: 11.5, color: 'var(--text3)', textAlign: 'center', padding: '12px 0', border: '1px dashed var(--border)', borderRadius: 8 }}>{vazio}</div>}
      <div style={destaque ? { display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 560, overflowY: 'auto' } : { display: 'flex', flexDirection: 'column', gap: 7 }}>
        {children}
      </div>
    </div>
  );
}

function CardItem({ item, empresa, compacto, ocupado, acoes, onAnexos, onAbrirEmpresa }) {
  const corLateral = item.concluido ? 'var(--ok)' : item.vencido ? 'var(--danger)' : item.prioridade === 'alta' ? 'var(--warn)' : 'var(--border)';
  const [cor, corDim] = STATUS_COR[item.status] || STATUS_COR.pendente;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${corLateral}`, borderRadius: 8,
      padding: '9px 10px', opacity: ocupado ? 0.55 : 1, transition: 'opacity .15s' }}>
      {compacto && empresa && (
        <button type="button" onClick={() => onAbrirEmpresa?.(empresa)} title="Abrir a empresa"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, marginBottom: 3, cursor: 'pointer',
            fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', maxWidth: '100%' }}>
          <Building2Icon size={11} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(empresa.nome)}</span>
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button type="button" onClick={() => acoes.alternarConcluido(item)} disabled={ocupado}
          title={item.concluido ? 'Reabrir (desfazer a baixa)' : 'Dar baixa'}
          style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer', marginTop: 1,
            border: `1.5px solid ${item.concluido ? 'var(--ok)' : 'var(--border2)'}`, background: item.concluido ? 'var(--ok)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {ocupado ? <Loader2Icon size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : item.concluido && <CheckIcon size={12} color="#fff" strokeWidth={3} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: item.concluido ? 'var(--text3)' : 'var(--text1)',
            textDecoration: item.concluido ? 'line-through' : 'none' }}>{item.titulo}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px',
              background: item.tipo === 'obrigacao' ? 'var(--info-dim)' : 'var(--accent-dim)', color: item.tipo === 'obrigacao' ? 'var(--info)' : 'var(--accent)' }}>
              {item.tipo === 'obrigacao' ? 'Obrigação' : 'Tarefa'}
            </span>
            {item.modulo && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{item.modulo}</span>}
            {item.vencimento && (
              <span style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: item.vencido ? 700 : 500,
                color: item.vencido ? 'var(--danger)' : 'var(--text3)' }}>
                <CalendarIcon size={10} /> {fmtData(item.vencimento)}
              </span>
            )}
            {item.tipo === 'obrigacao' && item.competencia && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{item.competencia}</span>}
          </div>
        </div>
        <BotaoAnexos qtd={item.anexos.length} onClick={onAnexos} tamanho={13} />
      </div>
      {item.tipo === 'obrigacao' && !compacto && (
        <select value={item.status} disabled={ocupado} onChange={(e) => acoes.mudarStatus(item, e.target.value)}
          style={{ marginTop: 8, width: '100%', fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
            background: corDim, color: cor, border: `1px solid ${cor}` }}>
          {STATUS_OBS.map((s) => <option key={s} value={s} style={{ color: 'var(--text1)', background: 'var(--surface)' }}>{STATUS_LABEL[s]}</option>)}
        </select>
      )}
      {compacto && item.concluido && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10.5, color: 'var(--text3)' }}>
          <RotateCcwIcon size={10} /> toque no ✓ pra reabrir
        </div>
      )}
    </div>
  );
}

function ModalAnexos({ item, empresa, acoes, onClose }) {
  return (
    <AnexosItemModal
      titulo={item.titulo}
      subtitulo={`${item.tipo === 'obrigacao' ? 'Obrigação' : 'Tarefa'}${empresa ? ` · ${nomeCurto(empresa.nome)}` : ''}`}
      anexos={item.anexos}
      concluido={item.concluido}
      onEnviar={(arquivo, opcoes) => acoes.anexar(item, arquivo, opcoes)}
      onAbrir={acoes.abrirAnexo}
      onClose={onClose}
    />
  );
}

function NovaTarefaModal({ empresa, onSalvar, onClose }) {
  const [titulo, setTitulo] = useState('');
  const [departamento, setDepartamento] = useState('geral');
  const [prioridade, setPrioridade] = useState('normal');
  const [vencimento, setVencimento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const salvar = async () => {
    if (!titulo.trim()) return;
    setSalvando(true);
    setErro(null);
    try { await onSalvar({ titulo: titulo.trim(), departamento, prioridade, vencimento: vencimento || null, observacao }); }
    catch (e) { setErro(e.message); setSalvando(false); }
  };
  const campo = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14, color: 'var(--text1)' };
  const rotulo = { fontSize: 11.5, color: 'var(--text2)', display: 'block', marginBottom: 4, fontWeight: 600 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)' }}>Nova tarefa</div>
            <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{nomeCurto(empresa.nome)}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)' }}><XIcon size={16} /></button>
        </div>
        <div><label style={rotulo}>Título *</label><input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Descreva a tarefa..." style={campo} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={rotulo}>Departamento</label>
            <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} style={campo}>
              {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select></div>
          <div><label style={rotulo}>Prioridade</label>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} style={campo}>
              <option value="normal">Normal</option><option value="alta">Alta</option>
            </select></div>
        </div>
        <div><label style={rotulo}>Vencimento</label><input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={campo} /></div>
        <div><label style={rotulo}>Observação</label><textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...campo, resize: 'vertical' }} /></div>
        {erro && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-accent" style={{ flex: 2, justifyContent: 'center' }} onClick={salvar} disabled={!titulo.trim() || salvando}>
            {salvando ? 'Salvando...' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Aviso({ children }) {
  return <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '24px 12px' }}>{children}</div>;
}
