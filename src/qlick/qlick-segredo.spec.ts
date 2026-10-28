import { QlickSegredoEntity } from './entities/qlick-segredo.entity';

const perguntas = [
  { alternativas: ['a', 'b'] },
  { alternativas: ['c', 'd', 'e'] },
  { alternativas: ['f', 'g', 'h', 'i'] },
  { alternativas: ['j', 'k', 'l', 'm', 'n'] },
];

const identidade = (n: number) => [...Array(n).keys()];
const ordenado = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('QlickSegredoEntity (spec 031)', () => {
  it('sortear: uma ordem por inscrito, com permutações válidas das perguntas e alternativas', () => {
    const s = QlickSegredoEntity.sortear(['a1', 'a2', 'a3'], perguntas, {
      perguntas: true,
      alternativas: true,
    });
    expect(Object.keys(s.ordens).sort()).toEqual(['a1', 'a2', 'a3']);
    for (const ordem of Object.values(s.ordens)) {
      expect(ordenado(ordem.perguntas)).toEqual(identidade(4));
      ordem.perguntas.forEach((p, rodada) => {
        // a ordem das alternativas da rodada tem o tamanho da pergunta daquela rodada
        const alt = ordem.alternativas[String(rodada)];
        expect(ordenado(alt)).toEqual(
          identidade(perguntas[p].alternativas.length),
        );
      });
    }
  });

  it('sortear: sem embaralhar perguntas, a ordem das perguntas é a identidade', () => {
    const s = QlickSegredoEntity.sortear(['a1'], perguntas, {
      perguntas: false,
      alternativas: true,
    });
    expect(s.ordens.a1.perguntas).toEqual(identidade(4));
  });

  it('sortear: sem embaralhar alternativas, cada rodada é a identidade', () => {
    const s = QlickSegredoEntity.sortear(['a1'], perguntas, {
      perguntas: true,
      alternativas: false,
    });
    s.ordens.a1.perguntas.forEach((p, rodada) => {
      expect(s.ordens.a1.alternativas[String(rodada)]).toEqual(
        identidade(perguntas[p].alternativas.length),
      );
    });
  });

  it('sortear: usa o sorteador recebido (Fisher-Yates)', () => {
    // sempre 0 → cada passo troca o último com o primeiro
    const s = QlickSegredoEntity.sortear(
      ['a1'],
      perguntas,
      { perguntas: true, alternativas: false },
      () => 0,
    );
    expect(s.ordens.a1.perguntas).toEqual([1, 2, 3, 0]);
  });

  it('perguntaDe / originalDe / exibidaDe traduzem nos dois sentidos', () => {
    const s = new QlickSegredoEntity({
      id: 'pt1',
      ordens: {
        a1: {
          perguntas: [2, 0, 1],
          alternativas: { '0': [3, 1, 0, 2], '1': [1, 0], '2': [2, 0, 1] },
        },
      },
    });
    expect(s.perguntaDe('a1', 0)).toBe(2);
    expect(s.originalDe('a1', 0, 0)).toBe(3);
    expect(s.exibidaDe('a1', 0, 3)).toBe(0);
    for (let pos = 0; pos < 4; pos++) {
      expect(s.exibidaDe('a1', 0, s.originalDe('a1', 0, pos)!)).toBe(pos);
    }
  });

  it('originalDe: posição fora do intervalo devolve undefined', () => {
    const s = new QlickSegredoEntity({
      id: 'pt1',
      ordens: { a1: { perguntas: [0], alternativas: { '0': [1, 0] } } },
    });
    expect(s.originalDe('a1', 0, 2)).toBeUndefined();
    expect(s.originalDe('a1', 0, -1)).toBeUndefined();
  });

  it('aluno sem ordem cai na identidade (defensivo)', () => {
    const s = new QlickSegredoEntity({ id: 'pt1', ordens: {} });
    expect(s.perguntaDe('x', 1)).toBe(1);
    expect(s.originalDe('x', 1, 2)).toBe(2);
    expect(s.exibidaDe('x', 1, 2)).toBe(2);
  });
});
