// Endereço do tomador na DPS (E0234). Nada sai da máquina: as buscas de CEP/CNPJ são falsas.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { separarEndereco, resolverEnderecoTomador } = require('../enderecoTomador')
const { carregarGabarito, montarDps } = require('../dps')
const { serializar } = require('../xml')

const GABARITO = carregarGabarito(fs.readFileSync(path.join(__dirname, 'golden', 'gabarito_dps.xml'), 'utf8'))
const EMPRESA = { cnpj: '47619250000178', codigoMunicipio: '3154606', regraCompetencia: 'mes_do_atendimento', servicoPadrao: {} }

const viaCep = (dados) => async (cep) => (dados[cep] ? { ...dados[cep], cep } : null)
const semCnpj = async () => null

test('separa logradouro, número, complemento e bairro do texto livre', () => {
  assert.deepEqual(separarEndereco('Rua Tal, 150, Sala 3, Centro, Belo Horizonte/MG, CEP 30100-000'),
    { cep: '30100000', logradouro: 'Rua Tal', numero: '150', complemento: 'Sala 3', bairro: 'Centro' })
  assert.deepEqual(separarEndereco('Av. Brasil 1200 - Funcionários - BH - MG 30140-001'),
    { cep: '30140001', logradouro: 'Av. Brasil', numero: '1200', complemento: '', bairro: 'Funcionários' })
  assert.equal(separarEndereco('Rua 7 de Setembro, nº 45').numero, '45')
  assert.equal(separarEndereco('Rua 7 de Setembro, nº 45').logradouro, 'Rua 7 de Setembro')
  assert.equal(separarEndereco('Rodovia X, s/n, Zona Rural').numero, 'S/N')
})

test('com CEP: município, logradouro e bairro do ViaCEP; número do texto', async () => {
  const e = await resolverEnderecoTomador({ endereco: 'R. Tal, 150, sala 3', cep: '30100-000', documento: '12345678000199' }, {
    buscarCep: viaCep({ 30100000: { logradouro: 'Rua Tal', bairro: 'Centro', ibge: '3106200' } }), buscarCnpj: semCnpj,
  })
  assert.deepEqual(e, { cMun: '3106200', CEP: '30100000', xLgr: 'Rua Tal', nro: '150', xCpl: 'sala 3', xBairro: 'Centro' })
})

test('CEP geral da cidade: logradouro e bairro do texto', async () => {
  const e = await resolverEnderecoTomador({ endereco: 'Rua das Flores 20, Jardim', cep: '', documento: '52998224725' }, {
    buscarCep: viaCep({ 35500000: { logradouro: '', bairro: '', ibge: '3122306' } }), buscarCnpj: semCnpj,
  })
  assert.equal(e, null) // sem CEP nenhum: não inventa
  const e2 = await resolverEnderecoTomador({ endereco: 'Rua das Flores 20, Jardim, 35500-000', documento: '52998224725' }, {
    buscarCep: viaCep({ 35500000: { logradouro: '', bairro: '', ibge: '3122306' } }), buscarCnpj: semCnpj,
  })
  assert.deepEqual(e2, { cMun: '3122306', CEP: '35500000', xLgr: 'Rua das Flores', nro: '20', xCpl: '', xBairro: 'Jardim' })
})

test('CNPJ sem CEP utilizável: usa o cadastro da Receita', async () => {
  let consultado = null
  const e = await resolverEnderecoTomador({ endereco: 'Rua sem cep 10', documento: '12.345.678/0001-99' }, {
    buscarCep: async () => null,
    buscarCnpj: async (cnpj) => { consultado = cnpj; return { ibge: '3106200', cep: '30130010', logradouro: 'Avenida Afonso Pena', numero: '1000', complemento: 'Sala 501', bairro: 'Centro' } },
  })
  assert.equal(consultado, '12.345.678/0001-99')
  assert.deepEqual(e, { cMun: '3106200', CEP: '30130010', xLgr: 'Avenida Afonso Pena', nro: '1000', xCpl: 'Sala 501', xBairro: 'Centro' })
})

test('CPF sem dados suficientes: devolve null (DPS sai como antes)', async () => {
  const e = await resolverEnderecoTomador({ endereco: 'Rua X 1', documento: '52998224725' }, {
    buscarCep: async () => { throw new Error('não deveria buscar') }, buscarCnpj: async () => { throw new Error('não deveria buscar') },
  })
  assert.equal(e, null)
})

test('DPS com toma/end na ordem do leiaute', () => {
  const dps = montarDps({
    gabarito: GABARITO, empresa: EMPRESA, ambiente: 'producao', serie: '900', nDps: 1, cpfTomador: '12345678000199',
    nomeTomador: 'L C Consultoria', descricao: 'Consultoria', valor: '1000.00', dataAtendimento: '2026-11-10',
    agora: new Date('2026-11-13T15:00:00Z'),
    enderecoTomador: { cMun: '3106200', CEP: '30100000', xLgr: 'Rua Tal', nro: '150', xCpl: '', xBairro: 'Centro' },
  })
  const xml = serializar(dps)
  assert.match(xml, /<toma><CNPJ>12345678000199<\/CNPJ><xNome>L C Consultoria<\/xNome><end><endNac><cMun>3106200<\/cMun><CEP>30100000<\/CEP><\/endNac><xLgr>Rua Tal<\/xLgr><nro>150<\/nro><xBairro>Centro<\/xBairro><\/end><\/toma>/)
})
