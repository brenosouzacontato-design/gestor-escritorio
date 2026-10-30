// PIX que o escritório pediu para o cliente identificar (Emitir NFS-e → Emitir pelo extrato →
// "Pedir ao cliente"). O cliente diz quem pagou (nome e CPF) ou que não é atendimento; o escritório
// confere e emite a nota. Aparece no painel do cliente e no link "todas as notas".
// API: painel-nfse.js (pix_pendentes / pix_responder).
import { useEffect, useState } from 'react';
import { CheckCircleIcon, HelpCircleIcon } from 'lucide-react';
import { listarPixPedidos, responderPix } from './nfsePainelApi';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const soDig = (v) => String(v || '').replace(/\D/g, '');
const fmtCpf = (c) => {
  const d = soDig(c).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
};

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

export default function PixParaIdentificar({ pix, onResponder }) {
  const faltam = pix.filter((p) => !p.resposta).length;
  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: '0 0 10px', lineHeight: 1.45 }}>
        Recebemos estes PIX e o banco não mostra o nome completo de quem pagou. Diga o nome e o CPF de cada um para emitirmos a nota,
        ou avise se não foi atendimento (ex.: transferência entre contas, reembolso).
        {faltam > 0 ? <b> Faltam {faltam}.</b> : <b style={{ color: 'var(--ok)' }}> Tudo respondido, obrigado!</b>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pix.map((p) => <LinhaPix key={p.id} p={p} onResponder={onResponder} />)}
      </div>
    </div>
  );
}

function LinhaPix({ p, onResponder }) {
  const r = p.resposta;
  const [editando, setEditando] = useState(!r);
  const [nome, setNome] = useState(r?.nome || '');
  const [cpf, setCpf] = useState(r?.cpf || '');
  const [obs, setObs] = useState(r?.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const enviar = async (campos) => {
    setSalvando(true);
    setErro(null);
    try {
      await onResponder(p, campos);
      setEditando(false);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };

  const campo = { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, var(--bg))', color: 'var(--text1)', fontFamily: 'inherit', minWidth: 0 };
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
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo de quem pagou" aria-label="Nome de quem pagou" style={{ ...campo, flex: '2 1 220px' }} />
            <input value={fmtCpf(cpf)} onChange={(e) => setCpf(soDig(e.target.value).slice(0, 11))} placeholder="CPF" inputMode="numeric" aria-label="CPF de quem pagou" style={{ ...campo, flex: '1 1 140px' }} />
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação" style={{ ...campo, flex: '2 1 200px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <button type="button" disabled={salvando || !nome.trim()} onClick={() => enviar({ nome, cpf, observacao: obs })}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent, var(--ok))', color: '#fff', opacity: salvando || !nome.trim() ? 0.6 : 1 }}>
              {salvando ? 'Salvando…' : 'Enviar'}
            </button>
            <button type="button" disabled={salvando} onClick={() => enviar({ nao_servico: true, observacao: obs })}
              title="Use a observação para dizer o que foi (ex.: transferência entre contas)"
              style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <HelpCircleIcon size={13} /> Não é atendimento
            </button>
            {r && <button type="button" onClick={() => setEditando(false)} style={{ fontSize: 12, border: 'none', background: 'none', color: 'var(--text3)', cursor: 'pointer' }}>cancelar</button>}
            {erro && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{erro}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
