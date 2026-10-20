import { useEffect, useState } from 'react';
import { Building2Icon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import PainelClientePage from './PainelClientePage';
import PainelCompartilhadoPage from './PainelCompartilhadoPage';
import { registrarVisualizacaoPainel, avisarEventoPainel } from './painelApi';
import { sessaoDoToken } from './AcessoPainel';

// Painel de um GRUPO de empresas num link só (?painel=token1,token2,...) — pra
// cliente dono de mais de uma empresa não receber um link por empresa. Uma
// barra no topo troca a empresa exibida; o painel em si é o mesmo de
// sempre (PainelCompartilhadoPage, ou PainelClientePage com &versao=1).
// A empresa escolhida fica na URL (&empresa=<id>) pra sobreviver a um F5.
// Visita/aviso pro escritório são registrados por empresa, quando o
// cliente abre cada uma (não só a primeira).
// `admin` = prévia de dentro do gestor: não registra visita nem mexe na URL.
// No link público cada item de `clienteIds` é o token do painel da empresa
// (ver AcessoPainel.jsx): o nome sai de painel_sessao com o token de cada
// uma, e o painel exibido usa o token da empresa escolhida.
export default function PainelGrupoPage({ clienteIds, competencia, versao, empresaInicial, admin = false }) {
  const [empresas, setEmpresas] = useState(null); // [{ id, nome, cnpj }] na ordem do link
  const [selecionada, setSelecionada] = useState(
    clienteIds.includes(empresaInicial) ? empresaInicial : clienteIds[0],
  );

  useEffect(() => {
    if (admin) {
      supabase.from('clientes').select('id, nome, cnpj').in('id', clienteIds)
        .then(({ data }) => {
          const porId = new Map((data || []).map((c) => [c.id, c]));
          setEmpresas(clienteIds.map((id) => porId.get(id)).filter(Boolean));
        });
      return;
    }
    // token que não abre (trocado pelo escritório) some da barra
    Promise.all(clienteIds.map((token) => sessaoDoToken(token)
      .then((s) => ({ id: token, nome: s.nome, cnpj: s.cnpj }))
      .catch(() => null)))
      .then((lista) => setEmpresas(lista.filter(Boolean)));
  }, [clienteIds.join(','), admin]);

  useEffect(() => {
    if (admin) return;
    registrarVisualizacaoPainel(selecionada, competencia, versao === 'completa' ? 'completa' : 'nova').catch(() => {});
    avisarEventoPainel(selecionada, 'visualizacao', { competencia });
    const url = new URL(window.location.href);
    url.searchParams.set('empresa', selecionada);
    window.history.replaceState(null, '', url);
  }, [selecionada]);

  // Nomes herdados da sincronização com o ERP vêm com o CNPJ na frente
  // ("48.976.362 AMANDA LIMA GONCALVES") — no seletor mostra só o nome.
  const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '');

  return (
    <div style={{ background: 'var(--bg)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', padding: '12px 12px 0' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', padding: '10px 12px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            <Building2Icon size={13} /> Suas empresas {empresas ? `· ${empresas.length}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {(empresas || clienteIds.map((id) => ({ id, nome: '...' }))).map((e) => {
              const ativa = e.id === selecionada;
              return (
                <button key={e.id} type="button" onClick={() => setSelecionada(e.id)} title={e.nome}
                  style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, maxWidth: 240,
                    cursor: 'pointer', borderRadius: 10, padding: '7px 12px', textAlign: 'left',
                    border: `1px solid ${ativa ? 'var(--navy)' : 'var(--border)'}`,
                    background: ativa ? 'var(--navy)' : 'var(--surface2)' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: ativa ? '#fff' : 'var(--text1)', maxWidth: '100%',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nomeCurto(e.nome)}
                  </span>
                  {e.cnpj && (
                    <span style={{ fontSize: 10, color: ativa ? 'var(--navy-text)' : 'var(--text3)' }}>{e.cnpj}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {versao === 'completa'
        ? <PainelClientePage key={selecionada} clienteId={selecionada} competencia={competencia} admin={admin} />
        : <PainelCompartilhadoPage key={selecionada} clienteId={selecionada} competencia={competencia} admin={admin} />}
    </div>
  );
}
