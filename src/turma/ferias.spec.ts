import { expandirIntervalo } from '../common/date.util';
import { TurmaEntity } from './entities/turma.entity';

describe('Ferias', () => {
  describe('expandirIntervalo', () => {
    it('expande [inicio, fim] inclusive', () => {
      expect(expandirIntervalo('2026-03-02', '2026-03-05')).toEqual([
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
      ]);
    });

    it('intervalo de um unico dia', () => {
      expect(expandirIntervalo('2026-03-02', '2026-03-02')).toEqual(['2026-03-02']);
    });
  });

  describe('modulo pula dias de ferias (deslizamento)', () => {
    it('empurra as aulas que caem dentro do periodo de ferias', () => {
      // Modulo de 5 aulas as segundas a partir de 2026-03-02.
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        tipoModalidade: 'MODULO_FECHADO',
        diasSemana: [1],
        dataInicio: '2026-03-02',
        totalAulas: 5,
      });

      // Ferias cobrindo 2026-03-16 (3a segunda).
      const bloqueadas = new Set(expandirIntervalo('2026-03-14', '2026-03-20'));
      const sessoes = turma.projetarSessoes(bloqueadas);

      expect(sessoes).toHaveLength(5);
      // A aula da semana de ferias desliza; as seguintes tambem.
      expect(sessoes.map((s) => s.data)).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-23',
        '2026-03-30',
        '2026-04-06',
      ]);
      expect(turma.calcularFimPrevisto(sessoes.map((s) => s.data))).toBe(
        '2026-04-06',
      );
    });
  });
});
