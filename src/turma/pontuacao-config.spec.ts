import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AlunoService } from './aluno.service';
import { TurmaEntity } from './entities/turma.entity';
import { XpService } from './xp.service';

/** Config de pontuacao: defaults da entidade + bloqueios de XP/ranking. */
describe('Config de pontuacao', () => {
  const novaTurma = (p: Partial<TurmaEntity> = {}) =>
    new TurmaEntity({ id: 't1', professorId: 'prof1', ...p });

  describe('defaults da TurmaEntity', () => {
    it('turma sem config assume XP e tudo ativo', () => {
      const cfg = novaTurma().configPontuacao;
      expect(cfg).toEqual({
        pontuacaoAtiva: true,
        nomePontuacao: 'XP',
        rankingAtivo: true,
        rotuloAdicionar: 'Adicionar',
        rotuloRemover: 'Remover',
      });
    });

    it('respeita config customizada (Aura / Moggar / Punir, sem ranking)', () => {
      const cfg = novaTurma({
        nomePontuacao: 'Aura',
        rankingAtivo: false,
        rotuloAdicionar: 'Moggar',
        rotuloRemover: 'Punir',
      }).configPontuacao;
      expect(cfg.nomePontuacao).toBe('Aura');
      expect(cfg.rankingAtivo).toBe(false);
      expect(cfg.rotuloAdicionar).toBe('Moggar');
      expect(cfg.rotuloRemover).toBe('Punir');
    });

    it('nome/rotulos em branco caem no default', () => {
      const cfg = novaTurma({ nomePontuacao: '   ', rotuloRemover: '' })
        .configPontuacao;
      expect(cfg.nomePontuacao).toBe('XP');
      expect(cfg.rotuloRemover).toBe('Remover');
    });
  });

  describe('XpService bloqueia pontuacao desativada', () => {
    it('lanca BadRequest quando pontuacaoAtiva=false', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(
          novaTurma({ pontuacaoAtiva: false }),
        ),
      };
      const service = new XpService(
        {} as never,
        turmaRepo as never,
        {} as never,
      );
      await expect(
        service.distribuir('prof1', 't1', 'a1', 50),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('AlunoService bloqueia ranking desativado', () => {
    it('lanca Forbidden quando rankingAtivo=false', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(
          novaTurma({ rankingAtivo: false }),
        ),
      };
      const service = new AlunoService(
        {} as never,
        turmaRepo as never,
        {} as never,
        {} as never,
      );
      await expect(service.ranking('t1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
