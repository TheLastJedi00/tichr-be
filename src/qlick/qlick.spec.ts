import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { CreateQlickDto, PerguntaDto } from './dto/create-qlick.dto';
import { QlickEntity } from './entities/qlick.entity';
import { QlickService } from './qlick.service';

const professorFake = (plano: 'PHD' | 'MESTRE' = 'PHD') =>
  ({
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: plano })),
  }) as never;

const dtoValido = (): CreateQlickDto => ({
  titulo: 'Revisão HTML',
  perguntas: [
    { enunciado: 'Tag de parágrafo?', alternativas: ['<p>', '<div>'], corretaIndex: 0 },
  ],
});

describe('QlickService', () => {
  it('bloqueia criação para não-PhD (403 QLICK_LOCKED)', async () => {
    const service = new QlickService(
      {} as never,
      professorFake('MESTRE'),
      {} as never,
    );
    await expect(service.criar('p1', dtoValido())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cria com duração default 60 quando ausente', async () => {
    const repo = {
      create: jest.fn().mockImplementation(async (q) => new QlickEntity({ ...(q as object), id: 'q1' })),
    };
    const service = new QlickService(
      repo as never,
      professorFake('PHD'),
      {} as never,
    );
    const q = await service.criar('p1', dtoValido());
    expect(q.duracaoSegundos).toBe(60);
    expect(q.perguntas).toHaveLength(1);
  });

  it('grava perguntas como objetos planos (Firestore recusa protótipo)', async () => {
    let salvo: QlickEntity | undefined;
    const repo = {
      create: jest.fn().mockImplementation(async (q) => {
        salvo = q as QlickEntity;
        return new QlickEntity({ ...(q as object), id: 'q1' });
      }),
    };
    const service = new QlickService(repo as never, professorFake('PHD'), {} as never);
    // pergunta com protótipo customizado (como chega do class-transformer)
    const pergunta = Object.assign(new PerguntaDto(), {
      enunciado: 'q',
      alternativas: ['a', 'b'],
      corretaIndex: 0,
    });
    await service.criar('p1', { titulo: 'X', perguntas: [pergunta] });
    expect(Object.getPrototypeOf(salvo!.perguntas[0])).toBe(Object.prototype);
  });

  it('rejeita corretaIndex fora do intervalo', async () => {
    const service = new QlickService(
      {} as never,
      professorFake('PHD'),
      {} as never,
    );
    const dto: CreateQlickDto = {
      titulo: 'X',
      perguntas: [{ enunciado: 'q', alternativas: ['a', 'b'], corretaIndex: 5 }],
    };
    await expect(service.criar('p1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('valida posse da turma quando turmaId é informado', async () => {
    const repo = { create: jest.fn().mockImplementation(async (q) => q) };
    const turmaService = { buscarTurma: jest.fn().mockResolvedValue({ id: 't1' }) };
    const service = new QlickService(
      repo as never,
      professorFake('PHD'),
      turmaService as never,
    );
    await service.criar('p1', { ...dtoValido(), turmaId: 't1' });
    expect(turmaService.buscarTurma).toHaveBeenCalledWith('p1', 't1');
  });
});
