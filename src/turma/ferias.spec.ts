import { expandirIntervalo } from '../common/date.util';
import { TurmaEntity } from './entities/turma.entity';
import { montarBloqueador } from './ferias.util';

describe('Ferias', () => {
  describe('montarBloqueador (isolamento de escopo)', () => {
    // turmaA -> Escola A; turmaB -> Escola B; turmaMod -> sem instituicao.
    const instDaTurma = new Map<string, string | undefined>([
      ['turmaA', 'escolaA'],
      ['turmaB', 'escolaB'],
      ['turmaMod', undefined],
    ]);

    it('ferias por instituicao so bloqueiam as turmas daquela escola', () => {
      const bloqueador = montarBloqueador(
        [],
        [{ instituicaoId: 'escolaA', dataInicio: '2026-07-06', dataFim: '2026-07-10' }],
        instDaTurma,
      );
      // Escola A: bloqueada no periodo.
      expect(bloqueador('turmaA').has('2026-07-08')).toBe(true);
      // Escola B e turma modular: NAO bloqueadas (isolamento).
      expect(bloqueador('turmaB').has('2026-07-08')).toBe(false);
      expect(bloqueador('turmaMod').has('2026-07-08')).toBe(false);
    });

    it('ferias globais bloqueiam todas as turmas', () => {
      const bloqueador = montarBloqueador(
        [],
        [{ dataInicio: '2026-07-06', dataFim: '2026-07-10' }],
        instDaTurma,
      );
      expect(bloqueador('turmaA').has('2026-07-08')).toBe(true);
      expect(bloqueador('turmaB').has('2026-07-08')).toBe(true);
      expect(bloqueador('turmaMod').has('2026-07-08')).toBe(true);
    });

    it('ferias por turma so bloqueiam aquela turma; excecoes sao globais', () => {
      const bloqueador = montarBloqueador(
        ['2026-05-01'],
        [{ turmaId: 'turmaA', dataInicio: '2026-07-06', dataFim: '2026-07-10' }],
        instDaTurma,
      );
      expect(bloqueador('turmaA').has('2026-07-08')).toBe(true);
      expect(bloqueador('turmaB').has('2026-07-08')).toBe(false);
      // excecao (feriado) vale para todas.
      expect(bloqueador('turmaA').has('2026-05-01')).toBe(true);
      expect(bloqueador('turmaB').has('2026-05-01')).toBe(true);
    });
  });

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
