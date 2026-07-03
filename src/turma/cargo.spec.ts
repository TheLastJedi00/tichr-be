import { NotFoundException } from '@nestjs/common';
import { CargoService } from './cargo.service';
import { AlunoEntity } from './entities/aluno.entity';
import { CargoEntity } from './entities/cargo.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { CargoRepository } from './repositories/cargo.repository';
import { TurmaRepository } from './repositories/turma.repository';

/** Testes do CargoService com repositórios mockados. */
describe('CargoService', () => {
  const PROF = 'prof1';
  const TURMA = 't1';

  let cargoRepo: jest.Mocked<
    Pick<CargoRepository, 'findByTurma' | 'findById' | 'create' | 'delete'>
  >;
  let alunoRepo: jest.Mocked<
    Pick<AlunoRepository, 'findByTurma' | 'definirCargos' | 'limparCargo'>
  >;
  let turmaRepo: jest.Mocked<Pick<TurmaRepository, 'findById'>>;
  let service: CargoService;

  beforeEach(() => {
    cargoRepo = {
      findByTurma: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };
    alunoRepo = {
      findByTurma: jest.fn(),
      definirCargos: jest.fn().mockResolvedValue(undefined),
      limparCargo: jest.fn().mockResolvedValue(undefined),
    };
    turmaRepo = { findById: jest.fn() };
    turmaRepo.findById.mockResolvedValue({ id: TURMA, professorId: PROF } as never);
    service = new CargoService(
      cargoRepo as unknown as CargoRepository,
      alunoRepo as unknown as AlunoRepository,
      turmaRepo as unknown as TurmaRepository,
    );
  });

  it('cadastra em lote ignorando vazios e duplicados', async () => {
    cargoRepo.create.mockImplementation(
      async (c) => new CargoEntity({ ...(c as object), id: 'x' }),
    );
    const criados = await service.adicionar(PROF, TURMA, [
      'Líder',
      ' Líder ',
      '',
      'Redator',
    ]);
    expect(criados).toHaveLength(2);
    expect(cargoRepo.create).toHaveBeenCalledTimes(2);
  });

  it('ao remover, desatribui de todos e apaga o cargo', async () => {
    cargoRepo.findById.mockResolvedValue(
      new CargoEntity({ id: 'c1', turmaId: TURMA }),
    );
    await service.remover(PROF, TURMA, 'c1');
    expect(alunoRepo.limparCargo).toHaveBeenCalledWith(TURMA, 'c1');
    expect(cargoRepo.delete).toHaveBeenCalledWith('c1');
  });

  it('recusa cargo de outra turma', async () => {
    cargoRepo.findById.mockResolvedValue(
      new CargoEntity({ id: 'c1', turmaId: 'outra' }),
    );
    await expect(service.remover(PROF, TURMA, 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('atribuir (N<->N)', () => {
    const alunos = () => [
      new AlunoEntity({ id: 'a1', turmaId: TURMA, nome: 'A', cargoIds: [] }),
      new AlunoEntity({ id: 'a2', turmaId: TURMA, nome: 'B', cargoIds: ['c9'] }),
      new AlunoEntity({ id: 'a3', turmaId: TURMA, nome: 'C', cargoIds: ['c1'] }),
    ];

    beforeEach(() => {
      cargoRepo.findById.mockResolvedValue(
        new CargoEntity({ id: 'c1', turmaId: TURMA }),
      );
    });

    it('adiciona a quem falta e remove de quem saiu (idempotente)', async () => {
      alunoRepo.findByTurma.mockResolvedValue(alunos());
      // Responsaveis finais por c1: a1 e a2 (a3 deixa de ter).
      const res = await service.atribuir(PROF, TURMA, 'c1', ['a1', 'a2']);

      const byId = Object.fromEntries(res.map((a) => [a.id, a.cargoIds]));
      expect(byId['a1']).toContain('c1'); // ganhou
      expect(byId['a2']).toEqual(['c9', 'c1']); // acumulou 2 cargos
      expect(byId['a3']).toEqual([]); // perdeu c1
      // a1 (add) e a3 (remove) mudaram; a2 (add) mudou => 3 escritas.
      expect(alunoRepo.definirCargos).toHaveBeenCalledTimes(3);
    });

    it('reenviar o mesmo conjunto nao escreve nada', async () => {
      alunoRepo.findByTurma.mockResolvedValue(alunos());
      await service.atribuir(PROF, TURMA, 'c1', ['a3']); // a3 ja tem c1
      expect(alunoRepo.definirCargos).not.toHaveBeenCalled();
    });
  });
});
