import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AlunoEntity } from './entities/aluno.entity';
import { EquipeEntity } from './entities/equipe.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { EquipeRepository } from './repositories/equipe.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { EquipeService } from './equipe.service';

/** Testes do EquipeService com repositorios mockados (sem Firestore real). */
describe('EquipeService', () => {
  const PROF = 'prof1';
  const TURMA = 't1';

  let equipeRepo: jest.Mocked<Pick<EquipeRepository, 'findByTurma' | 'findById' | 'create' | 'update' | 'delete'>>;
  let alunoRepo: jest.Mocked<Pick<AlunoRepository, 'findByTurma' | 'definirEquipe' | 'limparEquipe'>>;
  let turmaRepo: jest.Mocked<Pick<TurmaRepository, 'findById'>>;
  let service: EquipeService;

  const alunos = (n: number): AlunoEntity[] =>
    Array.from(
      { length: n },
      (_, i) => new AlunoEntity({ id: `a${i}`, turmaId: TURMA, nome: `Aluno ${i}` }),
    );

  beforeEach(() => {
    equipeRepo = {
      findByTurma: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    alunoRepo = {
      findByTurma: jest.fn(),
      definirEquipe: jest.fn(),
      limparEquipe: jest.fn(),
    };
    turmaRepo = { findById: jest.fn() };
    turmaRepo.findById.mockResolvedValue({ id: TURMA, professorId: PROF } as never);
    service = new EquipeService(
      equipeRepo as unknown as EquipeRepository,
      alunoRepo as unknown as AlunoRepository,
      turmaRepo as unknown as TurmaRepository,
    );
  });

  it('recusa turma de outro professor', async () => {
    turmaRepo.findById.mockResolvedValue({ id: TURMA, professorId: 'outro' } as never);
    await expect(service.listar(PROF, TURMA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cria equipe com data e cor normalizada', async () => {
    equipeRepo.create.mockImplementation(
      async (e) => new EquipeEntity({ ...(e as object), id: 'e1' }),
    );
    const eq = await service.criar(PROF, TURMA, {
      titulo: '  Time A  ',
      cor: '6366F1',
    });
    expect(eq.titulo).toBe('Time A');
    expect(eq.cor).toBe('#6366f1');
    expect(eq.criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ao remover, devolve alunos ao pool e apaga a equipe', async () => {
    equipeRepo.findById.mockResolvedValue(
      new EquipeEntity({ id: 'e1', turmaId: TURMA }),
    );
    await service.remover(PROF, TURMA, 'e1');
    expect(alunoRepo.limparEquipe).toHaveBeenCalledWith('e1');
    expect(equipeRepo.delete).toHaveBeenCalledWith('e1');
  });

  it('distribuir sem equipes lanca BadRequest', async () => {
    equipeRepo.findByTurma.mockResolvedValue([]);
    await expect(service.distribuir(PROF, TURMA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('distribui todos os alunos em equipes de tamanho similar', async () => {
    const equipes = [
      new EquipeEntity({ id: 'e1', turmaId: TURMA }),
      new EquipeEntity({ id: 'e2', turmaId: TURMA }),
      new EquipeEntity({ id: 'e3', turmaId: TURMA }),
    ];
    equipeRepo.findByTurma.mockResolvedValue(equipes);
    alunoRepo.findByTurma.mockResolvedValue(alunos(10));
    alunoRepo.definirEquipe.mockResolvedValue(undefined);

    const resultado = await service.distribuir(PROF, TURMA);

    // Todo aluno recebeu uma equipe valida.
    expect(resultado).toHaveLength(10);
    expect(resultado.every((a) => a.equipeId)).toBe(true);
    expect(alunoRepo.definirEquipe).toHaveBeenCalledTimes(10);

    // Tamanhos balanceados (diferenca <= 1).
    const contagem = new Map<string, number>();
    for (const a of resultado) {
      contagem.set(a.equipeId!, (contagem.get(a.equipeId!) ?? 0) + 1);
    }
    const tamanhos = [...contagem.values()];
    expect(Math.max(...tamanhos) - Math.min(...tamanhos)).toBeLessThanOrEqual(1);
  });
});
