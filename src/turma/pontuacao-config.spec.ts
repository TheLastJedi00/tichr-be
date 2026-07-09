import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { AlunoService } from './aluno.service';
import { TurmaEntity } from './entities/turma.entity';
import { XpService } from './xp.service';

/** ProfessorService fake que devolve um professor com o plano informado. */
const professorFake = (plano: 'PHD' | 'MESTRE' = 'PHD') =>
  ({
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: plano })),
  }) as never;

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
        niveis: { prata: 500, ouro: 1000, diamante: 2000, platina: 4000 },
      });
    });

    it('limiares de nivel: usa custom e normaliza ordem ascendente', () => {
      const cfg = novaTurma({
        nivelPrata: 300,
        nivelOuro: 200, // fora de ordem → normaliza para > prata
        nivelDiamante: 1500,
        nivelPlatina: 1000, // fora de ordem → normaliza para > diamante
      }).configPontuacao;
      expect(cfg.niveis.prata).toBe(300);
      expect(cfg.niveis.ouro).toBe(301);
      expect(cfg.niveis.diamante).toBe(1500);
      expect(cfg.niveis.platina).toBe(1501);
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
    it('lanca BadRequest quando pontuacaoAtiva=false (professor PhD)', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(
          novaTurma({ pontuacaoAtiva: false }),
        ),
      };
      const service = new XpService(
        {} as never,
        turmaRepo as never,
        {} as never,
        professorFake('PHD'),
      );
      await expect(
        service.distribuir('prof1', 't1', 'a1', 50),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanca Forbidden GAMIFICACAO quando professor nao e PhD', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(novaTurma({ pontuacaoAtiva: true })),
      };
      const service = new XpService(
        {} as never,
        turmaRepo as never,
        {} as never,
        professorFake('MESTRE'),
      );
      await expect(
        service.distribuir('prof1', 't1', 'a1', 50),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
        {} as never,
        { getProfile: async () => ({ atendePlano: () => true }) } as never,
      );
      await expect(service.ranking('t1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
