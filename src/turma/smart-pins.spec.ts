import { BadRequestException } from '@nestjs/common';
import {
  pinEhLegado,
  proximoPinCurto,
} from '../common/pin.util';
import { AlunoService } from './aluno.service';
import { AlunoEntity } from './entities/aluno.entity';

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
});
