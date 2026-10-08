import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { DefinirMultiplicadorDto } from './dto/definir-multiplicador.dto';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchService } from './wor-match.service';

/** O multiplicador de pontos da partida, escolhido pelo professor no lobby. */
describe('Tichr Wor — multiplicador de pontos', () => {
  const servico = (match: WorMatchEntity) => {
    const repo = {
      buscar: jest.fn().mockResolvedValue(match),
      atualizar: jest.fn((_id: string, dados: Partial<WorMatchEntity>) => {
        Object.assign(match, dados);
        return Promise.resolve();
      }),
      listarTeams: jest.fn().mockResolvedValue([]),
    } as unknown as WorMatchRepository;
    const professores = {
      getProfile: jest
        .fn()
        .mockResolvedValue(new ProfessorEntity({ planoAtual: 'PHD' })),
    } as never;
    const turmas = { findById: jest.fn() } as never;
    return new WorMatchService(
      {} as WorJogoRepository,
      repo,
      professores,
      turmas,
    );
  };
  const lobby = () =>
    new WorMatchEntity({ id: 'm1', professorId: 'p1', status: 'LOBBY' });

  it('a partida nasce valendo 1x', () => {
    expect(lobby().multiplicador).toBe(1);
  });

  it('o professor define o multiplicador no lobby', async () => {
    const match = lobby();
    const view = await servico(match).definirMultiplicador('p1', 'm1', 5);
    expect(match.multiplicador).toBe(5);
    expect(view.match.multiplicador).toBe(5);
  });

  it('depois que a partida começou, o multiplicador não muda (400)', async () => {
    const match = lobby();
    match.status = 'EM_ANDAMENTO';
    await expect(
      servico(match).definirMultiplicador('p1', 'm1', 3),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(match.multiplicador).toBe(1);
  });

  it('só o dono da partida define (403)', async () => {
    await expect(
      servico(lobby()).definirMultiplicador('outro', 'm1', 3),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a DTO aceita inteiros de 1 a 10', async () => {
    const erros = async (valor: unknown) =>
      (
        await validate(
          plainToInstance(DefinirMultiplicadorDto, { multiplicador: valor }),
        )
      ).length;
    expect(await erros(1)).toBe(0);
    expect(await erros(10)).toBe(0);
    expect(await erros(0)).toBeGreaterThan(0);
    expect(await erros(11)).toBeGreaterThan(0);
    expect(await erros(2.5)).toBeGreaterThan(0);
    expect(await erros('3')).toBeGreaterThan(0);
  });

  it('limites expostos nas constantes', () => {
    expect(WOR.MULTIPLICADOR_MIN).toBe(1);
    expect(WOR.MULTIPLICADOR_MAX).toBe(10);
  });
});
