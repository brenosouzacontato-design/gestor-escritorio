// Mini relatório da aba da empresa (src/pages/empresa/relatorioDoDiaRegras.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { janelaRelatorio, montarRelatorio } from '../../pages/empresa/relatorioDoDiaRegras.js';

const AGORA = new Date(2026, 10, 24, 15, 0); // 24/11/2026 15h (horário local)

test('janela: hoje e 7 dias, e o limite das guias a vencer', () => {
  const h = janelaRelatorio('hoje', AGORA);
  assert.equal(h.inicio, '2026-11-24');
  assert.equal(h.hoje, '2026-11-24');
  assert.equal(h.limiteGuias, '2026-11-29');
  assert.equal(janelaRelatorio('semana', AGORA).inicio, '2026-11-18');
});

test('monta os blocos do dia: gestor, OneFlow sem duplicar a NFS-e, documentos, pagamentos e guias', () => {
  const janela = janelaRelatorio('hoje', AGORA);
  const hojeTs = new Date(2026, 10, 24, 10).toISOString();
  const ontemTs = new Date(2026, 10, 23, 10).toISOString();
  const r = montarRelatorio({
    janela, agora: AGORA,
    nfse: [
      { id: 'n1', numero_nfse: '25', valor: 300, nome: 'Paciente A', atualizado_em: hojeTs },
      { id: 'n2', numero_nfse: '24', valor: 200, nome: 'Paciente B', atualizado_em: ontemTs },
    ],
    erp: [
      { id: 'e1', tipo_movimento: 'saida', numero: '000025', valor_total: 300, data_emissao: '2026-11-24' }, // a mesma NFS-e n1
      { id: 'e2', tipo_movimento: 'saida', numero: '900', valor_total: 1000, data_emissao: '2026-11-24', razao_social_terceiro: 'Cliente X' },
      { id: 'e3', tipo_movimento: 'entrada', numero: '7', valor_total: 50.5, data_emissao: '2026-11-24' },
      { id: 'e4', tipo_movimento: 'entrada', numero: '8', valor_total: 70, data_emissao: '2026-11-24', situacao_documento: 'Cancelada' },
      { id: 'e5', tipo_movimento: 'entrada', numero: '9', valor_total: 80, data_emissao: '2026-11-20' },
    ],
    documentos: [
      { id: 'd1', nome_arquivo: 'extrato.pdf', created_at: hojeTs, status: 'confirmado' },
      { id: 'd2', nome_arquivo: 'DAS.pdf', created_at: ontemTs, obrigacao_id: 'o1', pago_em: hojeTs, valor_guia: 1423.79, comprovante_path: 'c.pdf', status: 'confirmado' },
      { id: 'd3', nome_arquivo: 'INSS.pdf', created_at: ontemTs, obrigacao_id: 'o2', pago_em: hojeTs, valor_guia: 178.31, baixa_manual: true, status: 'confirmado' },
      { id: 'd4', nome_arquivo: 'FGTS.pdf', created_at: ontemTs, obrigacao_id: 'o3', vencimento_guia: '2026-11-27', valor_guia: 90, status: 'confirmado' },
      { id: 'd5', nome_arquivo: 'ISS.pdf', created_at: ontemTs, obrigacao_id: 'o4', vencimento_guia: '2026-12-10', valor_guia: 10, status: 'confirmado' },
      { id: 'd6', nome_arquivo: 'pendente.pdf', created_at: hojeTs, status: 'pendente' },
    ],
    esperando: { pixRespondidos: 6, notasProntas: 0 },
    ultimaSync: '2026-11-09T16:42:40Z',
  });
  assert.deepEqual(r.emitidasGestor.itens.map((n) => n.id), ['n1']);
  assert.deepEqual(r.saidasErp.itens.map((n) => n.id), ['e2']); // e1 é a NFS-e do gestor
  assert.deepEqual(r.entradas.itens.map((n) => n.id), ['e3']);
  assert.equal(r.entradas.valor, 50.5);
  assert.deepEqual(r.recebidos.itens.map((d) => d.id), ['d1']);
  assert.deepEqual(r.pagamentos.itens.map((d) => [d.id, d.manual]), [['d2', false], ['d3', true]]);
  assert.deepEqual(r.guiasAVencer.itens.map((d) => d.id), ['d4']);
  assert.equal(r.esperando.pixRespondidos, 6);
  assert.equal(r.sync.atrasada, true);
});

test('sem nada esperando, o aviso de NFS-e some; sincronização recente não é atrasada', () => {
  const r = montarRelatorio({ janela: janelaRelatorio('hoje', AGORA), agora: AGORA, esperando: { pixRespondidos: 0, notasProntas: 0 },
    ultimaSync: new Date(2026, 10, 24, 6).toISOString() });
  assert.equal(r.esperando, null);
  assert.equal(r.sync.atrasada, false);
});
