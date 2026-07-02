import { ProfessorEntity } from './entities/professor.entity';
import { TurmaEntity } from '../turma/entities/turma.entity';

/**
 * Testes puros das regras de plano/cota:
 * - limite efetivo por plano + slots avulsos (ProfessorEntity.limiteTurmas)
 * - se uma turma ocupa cota (TurmaEntity.contaComoAtiva)
 */
describe('Regras de plano e cota', () => {
  describe('ProfessorEntity.limiteTurmas', () => {
    it('usa a base do plano quando nao ha slots comprados', () => {
      expect(new ProfessorEntity({ planoAtual: 'ESTAGIARIO' }).limiteTurmas).toBe(2);
      expect(new ProfessorEntity({ planoAtual: 'GRADUADO' }).limiteTurmas).toBe(5);
    });

    it('soma os slots avulsos ao limite base', () => {
      const prof = new ProfessorEntity({
        planoAtual: 'ESTAGIARIO',
        slotsAdicionaisComprados: 3,
      });
      expect(prof.limiteTurmas).toBe(5);
    });

    it('e ilimitado para Mestre e PhD', () => {
      expect(new ProfessorEntity({ planoAtual: 'MESTRE' }).limiteTurmas).toBe(Infinity);
      expect(new ProfessorEntity({ planoAtual: 'PHD' }).limiteTurmas).toBe(Infinity);
    });

    it('cai para ESTAGIARIO por padrao (perfil recem-criado)', () => {
      expect(new ProfessorEntity({ uid: 'u1' }).limiteTurmas).toBe(2);
    });
  });

  describe('TurmaEntity.contaComoAtiva', () => {
    const hoje = '2026-07-02';

    it('nao conta turma encerrada manualmente', () => {
      const turma = new TurmaEntity({
        tipoModalidade: 'GRADE_FIXA',
        encerradaManualmente: true,
      });
      expect(turma.contaComoAtiva(hoje)).toBe(false);
    });

    it('conta grade fixa vigente', () => {
      const turma = new TurmaEntity({ tipoModalidade: 'GRADE_FIXA' });
      expect(turma.contaComoAtiva(hoje)).toBe(true);
    });

    it('nao conta modulo cujo fim ja passou', () => {
      const turma = new TurmaEntity({
        tipoModalidade: 'MODULO_FECHADO',
        dataFimPrevista: '2026-06-30',
      });
      expect(turma.contaComoAtiva(hoje)).toBe(false);
    });

    it('conta modulo cujo fim e hoje ou futuro', () => {
      const hojeMesmo = new TurmaEntity({
        tipoModalidade: 'MODULO_FECHADO',
        dataFimPrevista: '2026-07-02',
      });
      const futuro = new TurmaEntity({
        tipoModalidade: 'MODULO_FECHADO',
        dataFimPrevista: '2026-08-15',
      });
      expect(hojeMesmo.contaComoAtiva(hoje)).toBe(true);
      expect(futuro.contaComoAtiva(hoje)).toBe(true);
    });
  });
});
