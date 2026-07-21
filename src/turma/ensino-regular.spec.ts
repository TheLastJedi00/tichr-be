import { diasDaGrade } from './entities/turma.entity';

describe('diasDaGrade', () => {
  it('extrai dias distintos e ordenados das alocacoes', () => {
    const dias = diasDaGrade([
      { diaSemana: 2, periodo: 1 },
      { diaSemana: 2, periodo: 2 },
      { diaSemana: 4, periodo: 1 },
      { diaSemana: 1, periodo: 3 },
    ]);
    expect(dias).toEqual([1, 2, 4]);
  });

  it('retorna vazio para grade vazia/ausente', () => {
    expect(diasDaGrade([])).toEqual([]);
    expect(diasDaGrade()).toEqual([]);
  });
});
