// licenciamentoApi.js
// Alvarás e licenças das empresas (tabela licencas, ver
// supabase-schema-licencas.sql). Os avisos de vencimento no WhatsApp e a
// tarefa de renovação saem do lembretes-cron (netlify/functions/lib/licencas.js).
import { supabase } from '../../lib/supabase';
import { uploadArquivo } from '../documentos/documentosApi';

export const TIPOS = {
  funcionamento: {
    nome: 'Alvará de funcionamento', orgao: 'Prefeitura',
    checklist: ['Contrato social ou última alteração', 'Cartão CNPJ', 'IPTU ou contrato de locação do imóvel', 'Consulta de viabilidade / uso do solo', 'AVCB ou CLCB vigente', 'Comprovante da taxa paga'],
  },
  sanitario: {
    nome: 'Alvará sanitário', orgao: 'Vigilância Sanitária',
    checklist: ['Alvará de funcionamento vigente', 'Responsável técnico (quando exigido)', 'Laudo de controle de pragas', 'Comprovante de limpeza da caixa d’água', 'Planta ou croqui do layout', 'Comprovante da taxa paga'],
  },
  bombeiros: {
    nome: 'AVCB / CLCB (bombeiros)', orgao: 'Corpo de Bombeiros',
    checklist: ['Projeto ou planta aprovada (quando exigido)', 'ART/laudo das instalações elétricas', 'Certificado de recarga dos extintores', 'Atestado de brigada de incêndio', 'Comprovante da taxa paga'],
  },
  ambiental: {
    nome: 'Licença ambiental', orgao: 'Órgão ambiental',
    checklist: ['Requerimento do órgão', 'Licença anterior', 'Relatório ou plano de controle ambiental', 'Comprovante da taxa paga'],
  },
  outro: { nome: 'Outra licença', orgao: '', checklist: [] },
};

export const ETAPAS = {
  a_iniciar: 'A iniciar',
  aguardando_cliente: 'Aguardando cliente',
  protocolado: 'Protocolado',
};

export function nomeLicenca(l) {
  if (l.tipo === 'outro') return l.descricao?.trim() || 'Outra licença';
  return TIPOS[l.tipo]?.nome || 'Licença';
}

export function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function diasAte(validade, hoje = hojeISO()) {
  if (!validade) return null;
  return Math.round((Date.parse(`${validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86400000);
}

// Faixa do painel. Renovação em andamento tem a própria faixa, mesmo vencida.
export function faixa(l, hoje = hojeISO()) {
  if (l.etapa) return 'renovacao';
  const d = diasAte(l.data_validade, hoje);
  if (d === null) return 'em_dia';
  if (d < 0) return 'vencida';
  if (d <= 30) return 'ate30';
  if (d <= 90) return 'ate90';
  return 'em_dia';
}

// Tabela ainda não criada no banco
export function licencasNaoCriada(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /licencas/.test(error.message || ''));
}

export async function listarLicencas({ arquivadas = false } = {}) {
  const { data, error } = await supabase
    .from('licencas')
    .select('*, clientes(nome, municipio)')
    .eq('arquivada', arquivadas)
    .order('data_validade', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
}

// Empresas ativas com o município (para sugerir na ficha). Banco sem a
// coluna municipio: lista só o nome.
export async function listarClientesAtivos() {
  let { data, error } = await supabase.from('clientes').select('id, nome, municipio').eq('ativo', true).order('nome');
  if (error) ({ data, error } = await supabase.from('clientes').select('id, nome').eq('ativo', true).order('nome'));
  if (error) throw error;
  return data;
}

export async function listarAnexosLicencas() {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, licenca_id, nome_arquivo, storage_path, tamanho_bytes, created_at')
    .not('licenca_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

function linha(l) {
  const avisos = String(l.avisos_texto ?? (l.avisos_dias || []).join(', '))
    .split(/[^\d]+/).filter(Boolean).map(Number).filter((n) => n > 0 && n <= 365);
  return {
    cliente_id: l.cliente_id,
    tipo: l.tipo,
    descricao: l.descricao?.trim() || null,
    orgao: l.orgao?.trim() || null,
    numero: l.numero?.trim() || null,
    municipio: l.municipio?.trim() || null,
    data_emissao: l.data_emissao || null,
    data_validade: l.data_validade || null,
    etapa: l.etapa || null,
    protocolo: l.protocolo?.trim() || null,
    checklist: (l.checklist || []).filter((i) => i.texto?.trim()).map((i) => ({ texto: i.texto.trim(), ok: !!i.ok })),
    observacao: l.observacao?.trim() || null,
    avisos_dias: [...new Set(avisos)].sort((a, b) => b - a),
    criar_tarefa: !!l.criar_tarefa,
    updated_at: new Date().toISOString(),
  };
}

// `original`: a licença antes da edição. Mudou a validade → os avisos
// recomeçam para a nova data (e uma nova tarefa pode ser aberta).
export async function salvarLicenca(l, original = null) {
  const campos = linha(l);
  if (!original || original.data_validade !== campos.data_validade) {
    campos.avisos_enviados = [];
    campos.tarefa_id = null;
  }
  const { data, error } = l.id
    ? await supabase.from('licencas').update(campos).eq('id', l.id).select().single()
    : await supabase.from('licencas').insert(campos).select().single();
  if (error) throw error;
  return data;
}

// Renovação concluída: grava a nova validade, encerra a etapa, desmarca o
// checklist para o próximo ciclo e dá baixa na tarefa de renovação.
export async function registrarEmissao(l, { numero, data_emissao, data_validade }) {
  const agora = new Date().toISOString();
  const { error } = await supabase.from('licencas').update({
    numero: numero?.trim() || l.numero || null,
    data_emissao: data_emissao || null,
    data_validade: data_validade || null,
    etapa: null,
    protocolo: null,
    checklist: (l.checklist || []).map((i) => ({ ...i, ok: false })),
    avisos_enviados: [],
    tarefa_id: null,
    updated_at: agora,
  }).eq('id', l.id);
  if (error) throw error;
  if (l.tarefa_id) {
    await supabase.from('tarefas').update({ concluida: true, concluida_em: agora, updated_at: agora }).eq('id', l.tarefa_id);
  }
}

export async function arquivarLicenca(id, arquivada = true) {
  const { error } = await supabase.from('licencas').update({ arquivada, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function excluirLicenca(id) {
  const { error } = await supabase.from('licencas').delete().eq('id', id);
  if (error) throw error;
}

export async function anexarDocumentoLicenca({ clienteId, licencaId, arquivo }) {
  const storagePath = await uploadArquivo(arquivo);
  const { data, error } = await supabase.from('documentos').insert({
    cliente_id: clienteId,
    licenca_id: licencaId,
    nome_arquivo: arquivo.name,
    storage_path: storagePath,
    tipo_mime: arquivo.type || null,
    tamanho_bytes: arquivo.size,
    tipo_documento_sugerido: 'Licença / alvará',
    status: 'confirmado',
    confirmado_em: new Date().toISOString(),
  }).select('id, licenca_id, nome_arquivo, storage_path, tamanho_bytes, created_at').single();
  if (error) {
    await supabase.storage.from('documentos').remove([storagePath]).catch(() => {});
    throw error;
  }
  return data;
}

// Texto pronto para mandar ao cliente pedindo o que falta do checklist.
export function textoPedidoCliente(l) {
  const faltam = (l.checklist || []).filter((i) => !i.ok).map((i) => `• ${i.texto}`);
  return [
    `Olá! Estamos cuidando da renovação do ${nomeLicenca(l)}${l.clientes?.nome ? ` da ${l.clientes.nome}` : ''}.`,
    faltam.length ? 'Para dar entrada, precisamos de:' : 'Já temos todos os documentos, em breve damos entrada no órgão.',
    ...faltam,
    faltam.length ? 'Pode nos enviar por aqui mesmo. Obrigado!' : '',
  ].filter(Boolean).join('\n');
}

export function perguntaAssessor(l) {
  const municipio = l.municipio || l.clientes?.municipio;
  return `Quais documentos e passos são exigidos para ${l.etapa || l.data_validade ? 'renovar' : 'emitir'} o ${nomeLicenca(l)}` +
    `${l.orgao ? ` (${l.orgao})` : ''}${municipio ? ` no município de ${municipio}` : ''}? Liste os documentos, taxas, prazo de análise e o link oficial do serviço.`;
}
