import { ForbiddenException } from '@nestjs/common';
import { WorTeamEntity } from './entities/wor-team.entity';
import { equipe, fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

/** `GET /aluno/wor/:id/rodada`: as ações da rodada, só da própria equipe (029 §2.1). */
function cenario(teams: WorTeamEntity[]) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams), teams);
}

describe('Wor — rodada da equipe do aluno', () => {
  it('devolve as letras da própria equipe, sem dizer se acertaram', async () => {
    const teams = [equipe('e1', ['a1', 'a2', 'a3']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('a2', 'm1', 'Q', 'DICA');
    await service.chutarLetra('b1', 'm1', 'R', 'DICA');

    const r = await service.rodadaDaEquipe('a3', 'm1');
    expect(r).toEqual({
      equipeId: 'e1',
      fechou: null,
      acoes: [
        { alunoId: 'a1', nome: 'A1', tipo: 'LETRA', letra: 'A' },
        { alunoId: 'a2', nome: 'A2', tipo: 'LETRA', letra: 'Q' },
      ],
    });
    expect(JSON.stringify(r)).not.toContain('acertou');
    expect(JSON.stringify(r)).not.toContain('voto');
  });

  it('não mostra as ações de outra equipe', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1', 'b2'])];
    const { service } = cenario(teams);
    await service.chutarLetra('b1', 'm1', 'R', 'DICA');
    const r = await service.rodadaDaEquipe('a1', 'm1');
    expect(r.acoes).toEqual([]);
  });

  it('a equipe que já fechou recebe a ordem de chegada', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1', 'b2'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'xyz');
    const r = await service.rodadaDaEquipe('a1', 'm1');
    expect(r.fechou).toEqual({ ordem: 1, resultado: 'NADA' });
    expect(r.acoes).toEqual([{ alunoId: 'a1', nome: 'A1', tipo: 'ARRISCAR' }]);
  });

  it('quem não está em equipe é recusado', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await expect(service.rodadaDaEquipe('zz', 'm1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
