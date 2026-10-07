import { ModeracaoService } from './moderacao.service';

/**
 * O filtro de linguagem imprópria dos textos livres (chat do Wor). Tem de pegar
 * as grafias que o aluno usa para driblar o filtro — acento, letra repetida,
 * número no lugar de letra, sigla — sem barrar palavra comum de aula.
 */
describe('ModeracaoService', () => {
  const moderacao = new ModeracaoService();

  it.each([
    'vai tomar no cu',
    'seu merda',
    'PORRA',
    'caralhooo',
    'puta que pariu',
    'arrombado',
  ])('bloqueia palavrão comum: "%s"', (texto) => {
    expect(moderacao.contemPalavrao(texto)).toBe(true);
  });

  it.each(['PÔRRA', 'desgraçado', 'otário'])(
    'ignora acentos: "%s"',
    (texto) => {
      expect(moderacao.contemPalavrao(texto)).toBe(true);
    },
  );

  it.each(['p0rra', 'm3rda', 'arr0mbado', 'meeerda', 'piroka'])(
    'pega variações de grafia: "%s"',
    (texto) => {
      expect(moderacao.contemPalavrao(texto)).toBe(true);
    },
  );

  it.each(['fdp', 'FDP!', 'vsf', 'pqp', 'tnc'])('pega siglas: "%s"', (texto) => {
    expect(moderacao.contemPalavrao(texto)).toBe(true);
  });

  it.each([
    'bora atacar o castelo azul',
    'a palavra começa com C?',
    'cuidado com a Horda',
    'computador',
    'escuta, compra a dica',
    'cumprimento',
    'disputa',
    'reputação',
    'Curitiba e Cuiabá',
    'viaduto',
    'filho',
    '',
  ])('deixa passar texto limpo: "%s"', (texto) => {
    expect(moderacao.contemPalavrao(texto)).toBe(false);
  });
});
