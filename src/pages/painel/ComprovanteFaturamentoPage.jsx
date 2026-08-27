import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { obterHistoricoFaturamento } from './painelApi';

const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Contador padrão do escritório — assina todo Comprovante de Faturamento
// junto com o sócio do cliente (campo "Sócio (assinatura)" no cadastro,
// ver ClienteFormModal.jsx).
const CONTADOR = { nome: 'Nelson Alves dos Santos', cpf: '372.303.016-53', crc: 'CRC/MG 084614' };

function fmtMoeda(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtCnpj(cnpj) {
  if (!cnpj) return '—';
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtDataAbertura(iso) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function fmtCompetenciaAbrev(c) {
  const [mes, ano] = c.split('/').map(Number);
  return `${MES_ABREV[mes - 1]}/${ano}`;
}
function fmtCompetenciaExtenso(c) {
  const [mes, ano] = c.split('/').map(Number);
  return `${MES_EXTENSO[mes - 1]} de ${ano}`;
}
function fmtHoje() {
  return new Date().toLocaleDateString('pt-BR');
}

// Página pública (sem login) — "Declaração de Faturamento" pra empresas do
// Simples Nacional, com a receita bruta mês a mês já apurada pelas
// Declarações do Simples enviadas em Empresas.jsx (dados_gerenciais_simples,
// ver obterHistoricoFaturamento em painelApi.js). Mesmo modelo de link
// público do RelatorioCompartilhadoPage.jsx (DRE/Balancete): acessada via
// ?share=faturamento&empresa=<id> (ver main.jsx).
export default function ComprovanteFaturamentoPage({ empresaId }) {
  const [cliente, setCliente] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setErro(null);
      try {
        const [{ data: c, error: errCliente }, hist] = await Promise.all([
          supabase.from('clientes').select('nome, cnpj, regime, municipio, data_abertura, socio_nome').eq('id', empresaId).single(),
          obterHistoricoFaturamento(empresaId),
        ]);
        if (errCliente) throw errCliente;
        setCliente(c);
        setHistorico(hist);
      } catch (e) {
        setErro(e.message);
      }
    })();
  }, [empresaId]);

  const total = (historico || []).reduce((s, h) => s + Number(h.faturamento_periodo || 0), 0);
  const periodo = historico && historico.length > 0
    ? `${fmtCompetenciaExtenso(historico[0].competencia)} a ${fmtCompetenciaExtenso(historico[historico.length - 1].competencia)}`
    : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 36px' }}>
        {historico === null && !erro && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
        {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

        {historico !== null && !erro && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text1)', letterSpacing: '.02em' }}>DECLARAÇÃO DE FATURAMENTO</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>Simples Nacional — Receitas Brutas Mensais</div>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
              <LinhaInfo label="Razão Social" valor={cliente?.nome} />
              <LinhaInfo label="CNPJ" valor={fmtCnpj(cliente?.cnpj)} />
              {cliente?.municipio && <LinhaInfo label="Município" valor={cliente.municipio} />}
              {cliente?.data_abertura && <LinhaInfo label="Data de Abertura" valor={fmtDataAbertura(cliente.data_abertura)} />}
              <LinhaInfo label="Regime Tributário" valor={cliente?.regime || 'Simples Nacional'} />
              {periodo && <LinhaInfo label="Período da Declaração" valor={periodo} ultima />}
            </div>

            {historico.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                Nenhuma declaração do Simples Nacional com faturamento cadastrada ainda.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                  Declaro, para os devidos fins, que a empresa acima identificada apresentou as seguintes receitas
                  brutas mensais no período de {periodo}, conforme apurado pelo PGDAS-D — Programa Gerador do
                  Documento de Arrecadação do Simples Nacional Declaratório.
                </p>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <th style={th}>Mês de Referência</th>
                      <th style={{ ...th, textAlign: 'right' }}>Receita Bruta (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((h) => (
                      <tr key={h.competencia} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={td}>{fmtCompetenciaAbrev(h.competencia)}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="num">{fmtMoeda(h.faturamento_periodo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--navy)' }}>
                      <td style={{ ...td, fontWeight: 800 }}>TOTAL DO PERÍODO</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800 }} className="num">{fmtMoeda(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}

            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
              {cliente?.municipio ? `${cliente.municipio}, ` : ''}{fmtHoje()}.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 56 }}>
              <BlocoAssinatura nome={CONTADOR.nome} linhas={[CONTADOR.cpf, CONTADOR.crc]} papel="Contador" />
              <BlocoAssinatura nome={cliente?.socio_nome} linhas={[]} papel="Sócio" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Linha em branco pra assinatura física (documento impresso) — nome vem
// preenchido em cima da linha quando já souber quem assina (contador
// sempre; sócio só se o cadastro do cliente tiver "Sócio (assinatura)"
// preenchido, ver ClienteFormModal.jsx), senão fica só o espaço mesmo.
function BlocoAssinatura({ nome, linhas, papel }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ borderTop: '1px solid var(--text2)', paddingTop: 6, minHeight: 14 }}>
        {nome && <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text1)' }}>{nome}</div>}
      </div>
      {linhas.map((l, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>)}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{papel}</div>
    </div>
  );
}

function LinhaInfo({ label, valor, ultima }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: ultima ? 'none' : '1px solid var(--border)' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--text1)', fontWeight: 600, textAlign: 'right' }}>{valor || '—'}</span>
    </div>
  );
}

const th = { textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' };
const td = { padding: '7px 12px', color: 'var(--text1)' };
