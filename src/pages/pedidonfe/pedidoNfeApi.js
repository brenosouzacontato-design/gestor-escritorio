// pedidoNfeApi.js — chamadas do app de pedido de NF-e (netlify/functions/nfe-solicitacao.js).
// No link público vai o token do painel; dentro do gestor, o login do escritório + cliente_id.
import { cabecalhosFunctions } from '../../lib/supabase';

export async function chamarPedidoNfe(acao, dados = {}) {
  const resp = await fetch('/.netlify/functions/nfe-solicitacao', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify({ acao, ...dados }),
  });
  const r = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(r.error || `Não foi possível concluir (${resp.status}).`);
  return r;
}

const digitos = (v) => String(v || '').replace(/\D/g, '');

// Endereço pelo CEP (ViaCEP, público). null quando não achar.
export async function buscarCep(cep) {
  const d = digitos(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`).then((x) => x.json());
    if (r.erro) return null;
    return { logradouro: r.logradouro || '', bairro: r.bairro || '', municipio: r.localidade || '', uf: r.uf || '' };
  } catch { return null; }
}

// Nome e endereço pelo CNPJ (BrasilAPI, público). null quando não achar.
export async function buscarCnpj(cnpj) {
  const d = digitos(cnpj);
  if (d.length !== 14) return null;
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
    if (!resp.ok) return null;
    const r = await resp.json();
    return {
      nome: r.razao_social || '',
      cep: digitos(r.cep),
      logradouro: [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' '),
      numero: r.numero || '',
      complemento: r.complemento || '',
      bairro: r.bairro || '',
      municipio: r.municipio || '',
      uf: r.uf || '',
      email: r.email || '',
    };
  } catch { return null; }
}

export const FRETES = [
  { id: 'sem_frete', label: 'Sem frete' },
  { id: 'emitente', label: 'Por minha conta (quem vende)' },
  { id: 'destinatario', label: 'Por conta de quem compra' },
  { id: 'terceiros', label: 'Por conta de terceiros' },
];

export const STATUS = {
  recebida: { label: 'Recebido', cor: 'var(--info)', fundo: 'var(--info-dim)' },
  em_emissao: { label: 'Em emissão', cor: 'var(--warn)', fundo: 'var(--warn-dim)' },
  emitida: { label: 'Nota emitida', cor: 'var(--ok)', fundo: 'var(--ok-dim)' },
  cancelada: { label: 'Cancelado', cor: 'var(--text3)', fundo: 'var(--surface2)' },
  erro: { label: 'Com pendência', cor: 'var(--danger)', fundo: 'var(--danger-dim)' },
};

export const fmtMoeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtQuando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const numeroPedido = (id) => String(id || '').slice(0, 8).toUpperCase();

export function fmtDocumento(doc) {
  const d = digitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '';
}

// "1.234,56" | "10.5" → número (NaN quando vazio)
export function lerNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
