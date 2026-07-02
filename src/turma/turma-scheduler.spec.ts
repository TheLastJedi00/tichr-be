import { TurmaEntity } from './entities/turma.entity';

/**
 * Testes do Motor de Agendamento (TurmaEntity.projetarSessoes).
 * Funcao pura — nao depende de Firestore.
 */
describe('Motor de Agendamento', () => {
  describe('MODULO_FECHADO', () => {
    it('projeta exatamente totalAulas nas datas corretas sem excecoes', () => {
      // 2026-03-02 e uma segunda-feira. Aulas as segundas (1).
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        tipoModalidade: 'MODULO_FECHADO',
        diasSemana: [1],
        dataInicio: '2026-03-02',
        totalAulas: 5,
      });

      const sessoes = turma.projetarSessoes(new Set());

      expect(sessoes).toHaveLength(5);
      expect(sessoes.map((s) => s.data)).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
      ]);
      expect(sessoes.every((s) => s.status === 'AGENDADA')).toBe(true);
      expect(sessoes.map((s) => s.numero)).toEqual([1, 2, 3, 4, 5]);
    });

    it('desliza a aula e todas as seguintes ao cair numa excecao', () => {
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        tipoModalidade: 'MODULO_FECHADO',
        diasSemana: [1],
        dataInicio: '2026-03-02',
        totalAulas: 5,
      });

      // Feriado na 3a aula (2026-03-16).
      const sessoes = turma.projetarSessoes(new Set(['2026-03-16']));

      expect(sessoes).toHaveLength(5);
      // A aula 3 pula 16/03 e assume 23/03; as demais deslizam +1 semana.
      expect(sessoes.map((s) => s.data)).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-23',
        '2026-03-30',
        '2026-04-06',
      ]);
      // Continua sendo 5 aulas AGENDADAS, numeradas 1..5.
      expect(sessoes.every((s) => s.status === 'AGENDADA')).toBe(true);
      expect(sessoes.map((s) => s.numero)).toEqual([1, 2, 3, 4, 5]);

      const fim = turma.calcularFimPrevisto(sessoes.map((s) => s.data));
      expect(fim).toBe('2026-04-06');
    });

    it('nao entra em loop infinito se nunca houver dia valido', () => {
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        tipoModalidade: 'MODULO_FECHADO',
        diasSemana: [],
        dataInicio: '2026-03-02',
        totalAulas: 3,
      });

      const sessoes = turma.projetarSessoes(new Set());
      expect(sessoes).toHaveLength(0);
    });
  });

  describe('GRADE_FIXA', () => {
    it('marca a aula do feriado como CANCELADA sem deslizar', () => {
      // Aulas as segundas (1) e quartas (3).
      const turma = new TurmaEntity({
        id: 't2',
        professorId: 'p1',
        tipoModalidade: 'GRADE_FIXA',
        diasSemana: [1, 3],
        dataInicio: '2026-03-02',
      });

      // Feriado numa quarta (2026-03-04). Horizonte curto para o teste.
      const sessoes = turma.projetarSessoes(
        new Set(['2026-03-04']),
        '2026-03-11',
      );

      // Segundas e quartas entre 02/03 e 11/03: 02, 04, 09, 11.
      expect(sessoes.map((s) => s.data)).toEqual([
        '2026-03-02',
        '2026-03-04',
        '2026-03-09',
        '2026-03-11',
      ]);
      const cancelada = sessoes.find((s) => s.data === '2026-03-04');
      expect(cancelada?.status).toBe('CANCELADA');
      // As demais seguem AGENDADAS e nas mesmas datas (nao deslizam).
      expect(
        sessoes
          .filter((s) => s.data !== '2026-03-04')
          .every((s) => s.status === 'AGENDADA'),
      ).toBe(true);
    });

    it('nao define dataFimPrevista para grade fixa', () => {
      const turma = new TurmaEntity({
        id: 't2',
        professorId: 'p1',
        tipoModalidade: 'GRADE_FIXA',
        diasSemana: [1],
        dataInicio: '2026-03-02',
      });
      const sessoes = turma.projetarSessoes(new Set(), '2026-03-16');
      expect(turma.calcularFimPrevisto(sessoes.map((s) => s.data))).toBeUndefined();
    });
  });
});
