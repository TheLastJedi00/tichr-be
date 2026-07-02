import { AgrupamentoService } from './agrupamento.service';
import { AlunoEntity } from './entities/aluno.entity';

/** Testes do motor de agrupamento (funcao pura, sem Firestore). */
describe('AgrupamentoService', () => {
  const service = new AgrupamentoService();

  const alunos = (n: number): AlunoEntity[] =>
    Array.from(
      { length: n },
      (_, i) => new AlunoEntity({ id: `a${i}`, turmaId: 't1', nome: `Aluno ${i}` }),
    );

  it('cria exatamente N equipes', () => {
    const squads = service.sortear(alunos(10), 3);
    expect(squads).toHaveLength(3);
    expect(squads.map((s) => s.numero)).toEqual([1, 2, 3]);
  });

  it('distribui todos os alunos exatamente uma vez', () => {
    const squads = service.sortear(alunos(10), 3);
    const ids = squads.flatMap((s) => s.membros.map((m) => m.alunoId)).sort();
    expect(ids).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']);
  });

  it('gera equipes de tamanho similar (diferenca no maximo 1)', () => {
    const squads = service.sortear(alunos(10), 3);
    const tamanhos = squads.map((s) => s.membros.length);
    expect(Math.max(...tamanhos) - Math.min(...tamanhos)).toBeLessThanOrEqual(1);
  });

  it('distribui papeis sequencialmente dentro de cada equipe', () => {
    const squads = service.sortear(alunos(6), 2, ['Lider', 'Revisor']);
    for (const squad of squads) {
      squad.membros.forEach((m, i) => {
        expect(m.papel).toBe(['Lider', 'Revisor'][i % 2]);
      });
    }
  });

  it('sorteia um tema por equipe quando ha temas', () => {
    const squads = service.sortear(alunos(4), 2, [], ['IA', 'Web']);
    for (const squad of squads) {
      expect(['IA', 'Web']).toContain(squad.tema);
    }
  });

  it('deixa papel/tema indefinidos quando nao sao informados', () => {
    const squads = service.sortear(alunos(4), 2);
    expect(squads.every((s) => s.tema === undefined)).toBe(true);
    expect(
      squads.every((s) => s.membros.every((m) => m.papel === undefined)),
    ).toBe(true);
  });
});
