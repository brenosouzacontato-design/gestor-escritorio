// netlify/functions/nfse-mei.js
//
// NFS-e de MEI pelo Emissor Nacional (portal, login com CPF/CNPJ e senha). Só o escritório logado.
// O robô do servidor (deploy/robo-parcelamentos/nfse_mei.py) pega as notas 'na_fila', emite no portal,
// guarda PDF/XML e manda no WhatsApp do cliente. Tabelas: supabase-schema-nfse-mei.sql.
//   POST { acao: 'empresas' }                                → { empresas: [{ id, nome, cnpj, tem_senha, modelos, whatsapp }] }
//   POST { acao: 'carregar', cliente_id }                     → { modelos, notas, tem_senha }
//   POST { acao: 'salvar_senha', cliente_id, senha }          → { ok }   (cifrada; nunca volta para o navegador)
//   POST { acao: 'importar_senhas' }                         → { copiadas: [nomes], sem: [nomes] }  (MEIs sem senha: lê
//        a linha "... nfse: SENHA" das observações do cadastro e grava cifrada)
//   POST { acao: 'salvar_modelo', cliente_id, modelo }        → { modelo }  (com id: altera)
//   POST { acao: 'excluir_modelo', cliente_id, id }           → { ok }
//   POST { acao: 'emitir', cliente_id, nota, modelo_id?, confirmar_repetida? } → { nota } | { repetida }
//   POST { acao: 'tentar_de_novo', cliente_id, id, conferi_no_portal? } → { nota }
//   POST { acao: 'cancelar', cliente_id, id }                 → { ok }   (só antes de o robô pegar)
//   POST { acao: 'arquivo', cliente_id, id, tipo: 'pdf'|'xml' } → { url }  (link assinado, 10 min)
//   POST { acao: 'reenviar_whatsapp', cliente_id, id }        → { ok }

const { ErroHttp, exigirUsuario, responder, supabaseServico } = require('./lib/nfse/auth')
const { cifrar } = require('./lib/nfse/cofre')
const { ErroMei, normalizarModelo, normalizarNota, notaRepetida, senhaDasObservacoes } = require('./lib/nfse/mei')
const { enviarDocumento, numeroWhatsapp } = require('./lib/whatsapp')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUCKET = 'documentos'

function uuid(v, nome = 'id') {
  if (!UUID.test(String(v || ''))) throw new ErroHttp(400, `${nome} inválido`)
  return v
}

async function ok(q) {
  const { data, error } = await q
  if (error) {
    if (/nfse_mei_/.test(error.message || '')) throw new ErroHttp(500, 'Rode supabase-schema-nfse-mei.sql no Supabase.')
    throw new ErroHttp(500, error.message)
  }
  return data
}

async function cliente(sb, id) {
  const c = await ok(sb.from('clientes').select('id,nome,cnpj,regime,telefone,whatsapp_entrega').eq('id', uuid(id, 'cliente_id')).maybeSingle())
  if (!c) throw new ErroHttp(404, 'Empresa não encontrada')
  return c
}

async function nota(sb, clienteId, id) {
  const n = await ok(sb.from('nfse_mei_notas').select('*').eq('id', uuid(id)).eq('cliente_id', clienteId).maybeSingle())
  if (!n) throw new ErroHttp(404, 'Nota não encontrada')
  return n
}

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

exports.handler = responder(async (event) => {
  if (event.httpMethod !== 'POST') throw new ErroHttp(405, 'Use POST')
  const usuario = await exigirUsuario(event)
  let p
  try { p = JSON.parse(event.body || '{}') } catch { throw new ErroHttp(400, 'Corpo inválido') }
  const sb = supabaseServico()

  try {
    switch (p.acao) {
      case 'empresas': {
        const clientes = await ok(sb.from('clientes').select('id,nome,cnpj,telefone,whatsapp_entrega')
          .eq('regime', 'MEI').eq('ativo', true).order('nome'))
        const [acessos, modelos] = await Promise.all([
          ok(sb.from('nfse_mei_acessos').select('cliente_id')),
          ok(sb.from('nfse_mei_modelos').select('cliente_id').eq('ativo', true)),
        ])
        const comSenha = new Set(acessos.map((a) => a.cliente_id))
        const qtd = modelos.reduce((m, x) => ({ ...m, [x.cliente_id]: (m[x.cliente_id] || 0) + 1 }), {})
        return {
          empresas: clientes.map((c) => ({
            id: c.id, nome: c.nome, cnpj: c.cnpj, tem_senha: comSenha.has(c.id), modelos: qtd[c.id] || 0,
            whatsapp: !!numeroWhatsapp(c.whatsapp_entrega || c.telefone),
          })),
        }
      }

      case 'carregar': {
        const c = await cliente(sb, p.cliente_id)
        const [modelos, notas, acesso] = await Promise.all([
          ok(sb.from('nfse_mei_modelos').select('*').eq('cliente_id', c.id).eq('ativo', true).order('criado_em')),
          ok(sb.from('nfse_mei_notas').select('*').eq('cliente_id', c.id).order('criado_em', { ascending: false }).limit(30)),
          ok(sb.from('nfse_mei_acessos').select('atualizado_em').eq('cliente_id', c.id).maybeSingle()),
        ])
        return { modelos, notas, tem_senha: !!acesso, senha_em: acesso && acesso.atualizado_em,
          whatsapp: numeroWhatsapp(c.whatsapp_entrega || c.telefone) }
      }

      case 'salvar_senha': {
        const c = await cliente(sb, p.cliente_id)
        const senha = String(p.senha || '')
        if (!senha.trim()) throw new ErroHttp(400, 'Informe a senha do Emissor Nacional')
        await ok(sb.from('nfse_mei_acessos').upsert({ cliente_id: c.id, senha_cifrada: cifrar(senha), atualizado_em: new Date().toISOString() }))
        return { ok: true }
      }

      case 'importar_senhas': {
        // MEIs sem senha cadastrada: copia a linha "... nfse: SENHA" das observações do cadastro (cifrada)
        const clientes = await ok(sb.from('clientes').select('id,nome,observacoes').eq('regime', 'MEI').eq('ativo', true))
        const comSenha = new Set((await ok(sb.from('nfse_mei_acessos').select('cliente_id'))).map((a) => a.cliente_id))
        const copiadas = []
        const sem = []
        for (const c of clientes.filter((x) => !comSenha.has(x.id))) {
          const senha = senhaDasObservacoes(c.observacoes)
          if (!senha) { sem.push(c.nome); continue }
          await ok(sb.from('nfse_mei_acessos').insert({ cliente_id: c.id, senha_cifrada: cifrar(senha) }))
          copiadas.push(c.nome)
        }
        return { copiadas, sem }
      }

      case 'salvar_modelo': {
        const c = await cliente(sb, p.cliente_id)
        const m = { ...normalizarModelo(p.modelo), atualizado_em: new Date().toISOString() }
        if (p.modelo && p.modelo.id) {
          const r = await ok(sb.from('nfse_mei_modelos').update(m).eq('id', uuid(p.modelo.id)).eq('cliente_id', c.id).select().single())
          return { modelo: r }
        }
        return { modelo: await ok(sb.from('nfse_mei_modelos').insert({ ...m, cliente_id: c.id }).select().single()) }
      }

      case 'excluir_modelo': {
        const c = await cliente(sb, p.cliente_id)
        await ok(sb.from('nfse_mei_modelos').update({ ativo: false, atualizado_em: new Date().toISOString() }).eq('id', uuid(p.id)).eq('cliente_id', c.id))
        return { ok: true }
      }

      case 'emitir': {
        const c = await cliente(sb, p.cliente_id)
        const acesso = await ok(sb.from('nfse_mei_acessos').select('cliente_id').eq('cliente_id', c.id).maybeSingle())
        if (!acesso) throw new ErroHttp(400, 'Cadastre antes a senha do Emissor Nacional desta empresa.')
        const n = normalizarNota(p.nota || {})
        const existentes = await ok(sb.from('nfse_mei_notas').select('id,status,tomador_doc,valor,competencia,numero').eq('cliente_id', c.id))
        const rep = notaRepetida(n, existentes)
        if (rep && !p.confirmar_repetida) return { repetida: rep }
        const nova = await ok(sb.from('nfse_mei_notas').insert({
          ...n, cliente_id: c.id, modelo_id: p.modelo_id ? uuid(p.modelo_id, 'modelo_id') : null,
          status: 'na_fila', criado_por: usuario.email || null,
        }).select().single())
        return { nota: nova }
      }

      case 'tentar_de_novo': {
        const c = await cliente(sb, p.cliente_id)
        const n = await nota(sb, c.id, p.id)
        if (n.status !== 'erro') throw new ErroHttp(400, 'Só nota com erro pode ir para a fila de novo.')
        if (n.talvez_emitida && !p.conferi_no_portal) {
          throw new ErroHttp(409, 'O robô travou depois de clicar em "Emitir": confira no portal se a nota saiu antes de mandar de novo.')
        }
        const r = await ok(sb.from('nfse_mei_notas').update({
          status: 'na_fila', talvez_emitida: false, robo_mensagem: null, atualizado_em: new Date().toISOString(),
        }).eq('id', n.id).select().single())
        return { nota: r }
      }

      case 'cancelar': {
        const c = await cliente(sb, p.cliente_id)
        const n = await nota(sb, c.id, p.id)
        if (!['na_fila', 'erro'].includes(n.status)) throw new ErroHttp(400, 'O robô já está com esta nota.')
        if (n.talvez_emitida) throw new ErroHttp(400, 'Confira no portal antes: esta nota pode ter saído.')
        await ok(sb.from('nfse_mei_notas').update({ status: 'cancelada', atualizado_em: new Date().toISOString() }).eq('id', n.id))
        return { ok: true }
      }

      case 'arquivo': {
        const c = await cliente(sb, p.cliente_id)
        const n = await nota(sb, c.id, p.id)
        const caminho = p.tipo === 'xml' ? n.xml_path : n.pdf_path
        if (!caminho) throw new ErroHttp(404, 'Arquivo ainda não disponível')
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, 600)
        if (error) throw new ErroHttp(500, error.message)
        return { url: data.signedUrl }
      }

      case 'reenviar_whatsapp': {
        const c = await cliente(sb, p.cliente_id)
        const n = await nota(sb, c.id, p.id)
        if (n.status !== 'emitida' || !n.pdf_path) throw new ErroHttp(400, 'Nota ainda sem PDF.')
        const destino = numeroWhatsapp(c.whatsapp_entrega || c.telefone)
        if (!destino) throw new ErroHttp(400, 'Empresa sem WhatsApp no cadastro (WhatsApp de entrega ou telefone).')
        const nome = `NFS-e ${n.numero || ''} ${(n.tomador_nome || '').slice(0, 30)}`.trim()
        for (const [caminho, ext, mime, legenda] of [
          [n.pdf_path, 'pdf', 'application/pdf', `✅ NFS-e ${n.numero || ''} emitida${n.tomador_nome ? ` — ${n.tomador_nome}` : ''}\nValor: ${brl(n.valor)}`],
          [n.xml_path, 'xml', 'application/xml', ''],
        ]) {
          if (!caminho) continue
          const { data, error } = await sb.storage.from(BUCKET).download(caminho)
          if (error) throw new ErroHttp(500, error.message)
          const media = Buffer.from(await data.arrayBuffer()).toString('base64')
          const r = await enviarDocumento(destino, { media, fileName: `${nome}.${ext}`, caption: legenda, mimetype: mime })
          if (!r.sucesso) throw new ErroHttp(502, r.erro)
        }
        await ok(sb.from('nfse_mei_notas').update({ whatsapp_enviado_em: new Date().toISOString() }).eq('id', n.id))
        return { ok: true }
      }

      default:
        throw new ErroHttp(400, 'Ação desconhecida')
    }
  } catch (e) {
    if (e instanceof ErroMei) throw new ErroHttp(400, e.message)
    throw e
  }
})
