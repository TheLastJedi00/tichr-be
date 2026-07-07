import { BadRequestException } from '@nestjs/common';
import {
  pinEhLegado,
  proximoPinCurto,
} from '../common/pin.util';
import { AlunoService } from './aluno.service';
import { TurmaService } from './turma.service';
import { AlunoEntity } from './entities/aluno.entity';
import { TurmaEntity } from './entities/turma.entity';

describe('Smart PINs (2 dígitos)', () => {
  describe('proximoPinCurto', () => {
    it('começa em 01 e pula os já usados', () => {
      expect(proximoPinCurto(new Set())).toBe('01');
      expect(proximoPinCurto(new Set(['01', '02']))).toBe('03');
    });

    it('reaproveita lacunas', () => {
      expect(proximoPinCurto(new Set(['01', '03']))).toBe('02');
    });

    it('retorna null quando os 99 estão em uso', () => {
      const todos = new Set(
        Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0')),
      );
      expect(proximoPinCurto(todos)).toBeNull();
    });
  });

  describe('pinEhLegado', () => {
    it('marca PINs de 6 e 4 dígitos como legados', () => {
      expect(pinEhLegado('123456')).toBe(true);
      expect(pinEhLegado('1234')).toBe(true);
    });
    it('nao marca o formato curto (2 díg)', () => {
      expect(pinEhLegado('07')).toBe(false);
      expect(pinEhLegado(undefined)).toBe(false);
    });
  });

  describe('AlunoService.adicionar', () => {
    const montar = (existentes: AlunoEntity[] = []) => {
      const criados: AlunoEntity[] = [];
      const alunoRepo = {
        findByTurma: jest.fn().mockResolvedValue(existentes),
        create: jest.fn().mockImplementation(async (a: AlunoEntity) => {
          criados.push(a);
          return a;
        }),
      };
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue({ id: 't1', professorId: 'p1' }),
      };
      const service = new AlunoService(
        alunoRepo as never,
        turmaRepo as never,
        {} as never,
        {} as never,
        {} as never,
        { getProfile: async () => ({ atendePlano: () => true }) } as never,
      );
      return { service, criados };
    };

    it('gera PINs sequenciais de 2 dígitos (01, 02, ...)', async () => {
      const { service } = montar();
      const alunos = await service.adicionar('p1', 't1', ['Ana', 'Bruno', 'Caio']);
      expect(alunos.map((a) => a.pinAcesso)).toEqual(['01', '02', '03']);
    });

    it('continua a sequência a partir dos PINs já usados', async () => {
      const { service } = montar([
        new AlunoEntity({ id: 'x', turmaId: 't1', nome: 'Zé', pinAcesso: '01' }),
      ]);
      const alunos = await service.adicionar('p1', 't1', ['Ana']);
      expect(alunos[0].pinAcesso).toBe('02');
    });

    it('recusa passar de 99 alunos na turma', async () => {
      const existentes = Array.from(
        { length: 99 },
        (_, i) =>
          new AlunoEntity({ id: `a${i}`, turmaId: 't1', nome: `A${i}` }),
      );
      const { service } = montar(existentes);
      await expect(
        service.adicionar('p1', 't1', ['Novo']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('TurmaService.migrarPins', () => {
    it('regenera o PIN da turma (2 díg) e redistribui os PINs dos alunos', async () => {
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        pinTurma: '123456', // legado (6 díg)
        tipoModalidade: 'GRADE_FIXA',
        ativo: true,
      });
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(turma),
        findByProfessor: jest.fn().mockResolvedValue([turma]),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const alunos = [
        new AlunoEntity({ id: 'a2', turmaId: 't1', nome: 'Bruno', pinAcesso: '4444' }),
        new AlunoEntity({ id: 'a1', turmaId: 't1', nome: 'Ana', pinAcesso: '9999' }),
      ];
      const alunoRepo = {
        findByTurma: jest.fn().mockResolvedValue(alunos),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const service = new TurmaService(
        turmaRepo as never,
        {} as never,
        {} as never,
        {} as never,
        alunoRepo as never,
      );

      const res = await service.migrarPins('p1', 't1');

      expect(res.turma.pinTurma).toBe('01');
      // Sequência estável por nome: Ana (a1) -> '01', Bruno (a2) -> '02'.
      expect(alunoRepo.update).toHaveBeenCalledWith('a1', { pinAcesso: '01' });
      expect(alunoRepo.update).toHaveBeenCalledWith('a2', { pinAcesso: '02' });
    });
  });
});
