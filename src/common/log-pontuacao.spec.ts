import {
  creditoDe,
  creditosDaPartida,
  fmtPontos,
  itemAcerto,
} from './log-pontuacao';

/** Peças comuns do log de pontuação (spec 027 §1.2). */
describe('log-pontuacao', () => {
  const ganhos = [
    { alunoId: 'a1', pontos: 1200 },
    { alunoId: 'a2', pontos: 0 },
  ];

  it('com turma e valendo, o crédito é o próprio ganho', () => {
    expect(creditosDaPartida({ turmaId: 't1' }, ganhos)).toEqual(ganhos);
    expect(
      creditosDaPartida({ turmaId: 't1', valeRanking: true }, ganhos),
    ).toEqual(ganhos);
  });

  it('casual ou sem turma não credita nada', () => {
    expect(
      creditosDaPartida({ turmaId: 't1', valeRanking: false }, ganhos),
    ).toEqual([]);
    expect(creditosDaPartida({ turmaId: null }, ganhos)).toEqual([]);
    expect(creditosDaPartida({}, ganhos)).toEqual([]);
  });

  it('creditoDe ignora o que não é positivo, como o creditarPartida', () => {
    expect(creditoDe(ganhos, 'a1')).toBe(1200);
    expect(creditoDe(ganhos, 'a2')).toBe(0);
    expect(creditoDe([{ alunoId: 'a3', pontos: -5 }], 'a3')).toBe(0);
    expect(creditoDe([], 'a1')).toBe(0);
  });

  it('formata com separador de milhar', () => {
    expect(fmtPontos(1250)).toBe('1.250');
    expect(fmtPontos(-300)).toBe('300');
  });

  it('item de acerto separa a base da rapidez', () => {
    expect(itemAcerto(3, 'Pergunta', 1340, 1000)).toEqual({
      rodada: 3,
      fonte: 'ACERTO',
      descricao: 'Pergunta 3: acertou (+1.000) + rapidez (+340)',
      pontos: 1340,
    });
    expect(itemAcerto(2, 'Noite', 1000, 1000).descricao).toBe(
      'Noite 2: acertou (+1.000)',
    );
  });
});
