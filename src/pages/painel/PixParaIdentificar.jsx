// PIX que o escritório pediu para o cliente identificar (Emitir NFS-e → Emitir pelo extrato →
// "Pedir ao cliente"). O cliente diz quem pagou (nome e CPF) ou que não é atendimento; o escritório
// confere e emite a nota. Aparece no painel do cliente e no link "todas as notas".
// API: painel-nfse.js (pix_pendentes / pix_responder).
//
// Com muitos PIX a lista fica longa: dois blocos que abrem e fecham ("Faltam responder", aberto, e
// "Já respondidos", fechado) e, dentro de cada um, os PIX agrupados por quem pagou (o nome que o
// banco mostra no extrato). Quem paga toda semana vira um grupo só, que pode ser respondido de uma vez.
import { useEffect, useState } from 'react';
import { CheckCircleIcon, ChevronDownIcon, HelpCircleIcon } from 'lucide-react';
import { listarPixPedidos, responderPix } from './nfsePainelApi';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const soDig = (v) => String(v || '').replace(/\D/g, '');
const fmtCpf = (c) => {
  const d = soDig(c).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
};
const total = (lista) => lista.reduce((s, p) => s + Number(p.valor || 0), 0);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// [lista, responder]: a lista começa vazia e fica vazia se a function falhar (a seção só não aparece)
export function usePixPedidos(clienteId) {
  const [pix, setPix] = useState([]);
  useEffect(() => {
    let ativo = true;
    listarPixPedidos(clienteId).then((l) => ativo && setPix(l)).catch(() => ativo && setPix([]));
    return () => { ativo = false; };
  }, [clienteId]);
  const responder = async (item, campos) => {
    const salvo = await responderPix(clienteId, item.id, campos);
    setPix((l) => l.map((x) => (x.id === salvo.id ? salvo : x)));
  };
  return [pix, responder];
}

// Agrupa pelo nome do extrato (sem diferença de maiúsculas/espaços); grupos na ordem do PIX mais antigo
function agruparPorPagador(lista) {
  const grupos = new Map();
  for (const p of lista) {
    const chave = String(p.nomeExtrato || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!grupos.has(chave)) grupos.set(chave, { chave, nome: p.nomeExtrato || '', itens: [] });
    grupos.get(chave).itens.push(p);
  }
  return [...grupos.values()];
}

export default function PixParaIdentificar({ pix, onResponder }) {
  const pendentes = pix.filter((p) => !p.resposta);
  const respondidos = pix.filter((p) => p.resposta);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: '0 0 10px', lineHeight: 1.45 }}>
        Recebemos estes PIX e o banco não mostra o nome completo de quem pagou. Diga o nome e o CPF de cada um para emitirmos a nota,
        ou avise se não foi atendimento (ex.: transferência entre contas, reembolso).
        {pendentes.length > 0 ? <b> Faltam {pendentes.length}.</b> : <b style={{ color: 'var(--ok)' }}> Tudo respondido, obrigado!</b>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pendentes.length > 0 && (
          <BlocoPix rotulo="Faltam responder" lista={pendentes} cor="var(--warn)" abertoInicial onResponder={onResponder} />
        )}
        {respondidos.length > 0 && (
          <BlocoPix rotulo="Já respondidos" lista={respondidos} cor="var(--ok)" onResponder={onResponder} />
        )}
      </div>
    </div>
  );
}

// Bloco que abre e fecha (mesmo visual dos grupos de notas do painel): quantidade e total no cabeçalho
function BlocoPix({ rotulo, lista, cor, abertoInicial = false, onResponder }) {
  const [aberto, setAberto] = useState(abertoInicial);
  const grupos = agruparPorPagador(lista);
  const pendente = lista.some((p) => !p.resposta);
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${cor}`, borderRadius: 'var(--r-md, 10px)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
            {rotulo} · {plural(lista.length, 'PIX', 'PIX')}{grupos.length > 1 ? ` · ${plural(grupos.length, 'pagador', 'pagadores')}` : ''}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 3 }}>{fmt(total(lista))}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)',
          background: 'var(--accent-dim)', borderRadius: 99, padding: '5px 10px', whiteSpace: 'nowrap' }}>
          {aberto ? 'Ocultar' : 'Ver PIX'}
          <ChevronDownIcon size={13} style={{ transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </span>
      </button>
      {aberto && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grupos.map((g) => (g.itens.length > 1
            ? <GrupoPagador key={g.chave} g={g} pendente={pendente} onResponder={onResponder} />
            : <LinhaPix key={g.itens[0].id} p={g.itens[0]} onResponder={onResponder} />))}
        </div>
      )}
    </div>
  );
}

// Vários PIX com o mesmo nome no extrato: um cabeçalho (quantidade, total, período) que abre a lista.
// Com mais de um ainda sem resposta, dá para responder todos de uma vez.
function GrupoPagador({ g, pendente, onResponder }) {
  const [aberto, setAberto] = useState(false);
  const [todos, setTodos] = useState(false);
  const datas = g.itens.map((p) => p.data).filter(Boolean).sort();
  const periodo = datas.length ? (datas[0] === datas[datas.length - 1] ? fmtData(datas[0]) : `${fmtData(datas[0])} a ${fmtData(datas[datas.length - 1])}`) : '';
  const semResposta = g.itens.filter((p) => !p.resposta);

  const responderTodos = async (campos) => {
    // um por vez: se algum falhar, os anteriores já ficaram salvos e o erro aparece no formulário
    for (const p of semResposta) await onResponder(p, campos);
    setTodos(false);
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface, var(--bg))', overflow: 'hidden' }}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{g.nome ? `“${g.nome}”` : 'Sem nome no extrato'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{plural(g.itens.length, 'PIX', 'PIX')}{periodo ? ` · ${periodo}` : ''}</div>
        </div>
        <b style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{fmt(total(g.itens))}</b>
        <ChevronDownIcon size={15} style={{ color: 'var(--text3)', transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {aberto && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendente && semResposta.length > 1 && (todos ? (
            <div style={{ border: '1px dashed var(--border2, var(--border))', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                Mesma resposta para os {semResposta.length} PIX de {g.nome ? `“${g.nome}”` : 'sem nome'} ({fmt(total(semResposta))}):
              </div>
              <FormResposta onEnviar={responderTodos} onCancelar={() => setTodos(false)} rotuloEnviar={`Enviar para os ${semResposta.length}`} />
            </div>
          ) : (
            <button type="button" onClick={() => setTodos(true)}
              style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--accent)',
                background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
              Responder os {semResposta.length} de uma vez
            </button>
          ))}
          {g.itens.map((p) => <LinhaPix key={p.id} p={p} onResponder={onResponder} />)}
        </div>
      )}
    </div>
  );
}

function LinhaPix({ p, onResponder }) {
  const r = p.resposta;
  const [editando, setEditando] = useState(!r);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--surface, var(--bg))' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>{fmt(p.valor)}</b>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>PIX de {fmtData(p.data)}</span>
        {p.nomeExtrato && <span style={{ fontSize: 12, color: 'var(--text3)' }}>no extrato: “{p.nomeExtrato}”</span>}
      </div>

      {!editando && r ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5 }}>
          <CheckCircleIcon size={14} style={{ color: 'var(--ok)' }} />
          {r.nao_servico
            ? <span>Você informou que <b>não é atendimento</b>{r.observacao ? ` (${r.observacao})` : ''}</span>
            : <span>Você informou: <b>{r.nome}</b>{r.cpf ? ` · CPF ${fmtCpf(r.cpf)}` : ' · sem CPF'}{r.observacao ? ` · ${r.observacao}` : ''}</span>}
          <button type="button" onClick={() => setEditando(true)}
            style={{ border: 'none', background: 'none', color: 'var(--accent, var(--info))', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}>alterar</button>
        </div>
      ) : (
        <FormResposta inicial={r} onEnviar={async (campos) => { await onResponder(p, campos); setEditando(false); }}
          onCancelar={r ? () => setEditando(false) : null} />
      )}
    </div>
  );
}

// Nome + CPF + observação, ou "não é atendimento". `onEnviar` recebe os campos e pode lançar erro.
function FormResposta({ inicial = null, onEnviar, onCancelar = null, rotuloEnviar = 'Enviar' }) {
  const [nome, setNome] = useState(inicial?.nome || '');
  const [cpf, setCpf] = useState(inicial?.cpf || '');
  const [obs, setObs] = useState(inicial?.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const enviar = async (campos) => {
    setSalvando(true);
    setErro(null);
    try {
      await onEnviar(campos);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };

  const campo = { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)', fontFamily: 'inherit', minWidth: 0 };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo de quem pagou" aria-label="Nome de quem pagou" style={{ ...campo, flex: '2 1 220px' }} />
        <input value={fmtCpf(cpf)} onChange={(e) => setCpf(soDig(e.target.value).slice(0, 11))} placeholder="CPF" inputMode="numeric" aria-label="CPF de quem pagou" style={{ ...campo, flex: '1 1 140px' }} />
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação" style={{ ...campo, flex: '2 1 200px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <button type="button" disabled={salvando || !nome.trim()} onClick={() => enviar({ nome, cpf, observacao: obs })}
          style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent, var(--ok))', color: '#fff', opacity: salvando || !nome.trim() ? 0.6 : 1 }}>
          {salvando ? 'Salvando…' : rotuloEnviar}
        </button>
        <button type="button" disabled={salvando} onClick={() => enviar({ nao_servico: true, observacao: obs })}
          title="Use a observação para dizer o que foi (ex.: transferência entre contas)"
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <HelpCircleIcon size={13} /> Não é atendimento
        </button>
        {onCancelar && <button type="button" onClick={onCancelar} style={{ fontSize: 12, border: 'none', background: 'none', color: 'var(--text3)', cursor: 'pointer' }}>cancelar</button>}
        {erro && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{erro}</span>}
      </div>
    </div>
  );
}
