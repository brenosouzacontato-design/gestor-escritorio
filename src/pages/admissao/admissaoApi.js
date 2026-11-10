// admissaoApi.js — chamadas da ficha de admissão (netlify/functions/admissao.js).
// Na página do candidato vai o token do link; no gestor, o login do escritório.
import { supabase, cabecalhosFunctions } from '../../lib/supabase';
import CAMPOS from '../../../netlify/functions/lib/admissaoCampos.json';

export { CAMPOS };

const URL_FUNCAO = '/.netlify/functions/admissao';

export const STATUS = {
  aguardando: { label: 'Link enviado', cor: 'var(--text3)' },
  preenchendo: { label: 'Preenchendo', cor: 'var(--info)' },
  enviada: { label: 'Recebida', cor: 'var(--warn)' },
  devolvida: { label: 'Devolvida', cor: 'var(--danger)' },
  concluida: { label: 'Cadastrada no OneFlow', cor: 'var(--ok)' },
  cancelada: { label: 'Cancelada', cor: 'var(--text3)' },
};

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

class ErroComPendencias extends Error {}

async function chamar(corpo, headers) {
  const resp = await fetch(URL_FUNCAO, { method: 'POST', headers, body: JSON.stringify(corpo) });
  const r = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new ErroComPendencias(r.error || `Não foi possível concluir (${resp.status}).`);
    e.pendencias = r.pendencias || null;
    e.status = resp.status;
    throw e;
  }
  return r;
}

// candidato
export const chamarFicha = (token, acao, dados = {}) => chamar({ token, acao, ...dados }, { 'Content-Type': 'application/json' });
// escritório
export const chamarAdmissao = async (acao, dados = {}) => chamar({ acao, ...dados }, await cabecalhosFunctions());

// ---------- regras simples na tela (o servidor confere tudo de novo) ----------

export function campoAtivo(item, dados = {}) {
  if (item.seDependentes) return (dados.dependentes || []).length > 0;
  if (!item.se) return true;
  return item.se.valores.includes(dados[item.se.campo]);
}

export function faltandoNaSecao(secao, dados) {
  return secao.campos.filter((c) => c.obrigatorio && campoAtivo(c, dados) && !String(dados[c.id] || '').trim());
}

export function anexosFaltando(dados, documentos) {
  return CAMPOS.anexos.filter((a) => a.obrigatorio && campoAtivo(a, dados) && !documentos.some((d) => d.tipo === a.id));
}

// ---------- máscaras ----------

const dig = (v) => String(v || '').replace(/\D/g, '');
export function mascarar(tipo, valor) {
  const d = dig(valor);
  if (tipo === 'cpf') return d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  if (tipo === 'pis') return d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{5})(\d)/, '$1.$2').replace(/(\d{2})(\d)$/, '$1-$2');
  if (tipo === 'cep') return d.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
  if (tipo === 'telefone') {
    const t = d.length > 11 && d.startsWith('55') ? d.slice(2) : d.slice(0, 11);
    return t.length > 10 ? t.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : t.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (m, a, b, c) => (b ? `(${a}) ${b}${c ? '-' + c : ''}` : a));
  }
  return valor ?? '';
}

export async function buscarCep(cep) {
  const d = dig(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`).then((x) => x.json());
    if (r.erro) return null;
    return { logradouro: r.logradouro || '', bairro: r.bairro || '', municipio: r.localidade || '', uf: r.uf || '' };
  } catch { return null; }
}

// ---------- fotos ----------

// Foto do celular (3–8 MB) vira JPEG de até 1800 px (~300–600 KB). PDF e o que
// o navegador não consegue desenhar (ex.: HEIC fora do iPhone) vão como estão.
export async function prepararArquivo(arquivo) {
  if (!arquivo.type.startsWith('image/') || arquivo.type === 'image/gif') return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo;
  }
}

// Pede a URL ao servidor, manda o arquivo direto ao Storage e registra na ficha.
export async function enviarAnexo(token, tipo, arquivoOriginal) {
  const arquivo = await prepararArquivo(arquivoOriginal);
  if (arquivo.size > 15 * 1024 * 1024) throw new Error('Arquivo maior que 15 MB. Tire uma foto em vez de enviar o arquivo.');
  const mime = arquivo.type || 'application/octet-stream';
  const { path, token: tokenUpload } = await chamarFicha(token, 'url_upload', { tipo, nome: arquivo.name, mime });
  const { error } = await supabase.storage.from('documentos').uploadToSignedUrl(path, tokenUpload, arquivo, { contentType: mime });
  if (error) throw new Error('Falha ao enviar o arquivo: ' + error.message);
  return chamarFicha(token, 'registrar_documento', { tipo, path, nome: arquivo.name, mime, tamanho: arquivo.size });
}

export function baixarBase64(base64, nome, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
