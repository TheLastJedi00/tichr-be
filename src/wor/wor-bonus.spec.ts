import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { equipe, fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

/** Bônus individual de acerto (029 §6A): do aluno, não da equipe. */
function cenario(teams: WorTeamEntity[], over: Partial<WorMatchEntity> = {}) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams, over), teams);
}

const ultimaOnda: Partial<WorMatchEntity> = {
  ondaIndex: 1,
  mascara: ['R', 'E', '_'],
  letrasTentadas: ['R', 'E'],
  cartasVisiveis: ['x1'],
  totalCartas: 1,
};

describe('Wor — bônus individual de acerto (029 §6A)', () => {
  it('os valores ficam nas constantes', () => {
    expect(WOR.BONUS_ACERTO_PALAVRA).toBe(1000);
    expect(WOR.BONUS_ACERTO_LETRA).toBe(300);
  });

  it('arriscar e acertar: +1000 só para quem arriscou, fora do team.pontos', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0].pontosIndividuais).toEqual({ a1: 1000 });
    expect(teams[0].pontos).toBe(WOR.BONUS_ARRISCAR); // a equipe mantém o seu
    expect(teams[0].logIndividual.a1).toEqual([
      expect.objectContaining({
        fonte: 'ACERTO_PALAVRA',
        pontos: 1000,
        rodada: 1,
      }),
    ]);
  });

  it('a Invasão certa também rende o bônus da palavra', async () => {
    const teams = [
      equipe('e1', ['a1'], { hp: 0, isHorde: true }),
      equipe('e2', ['b1']),
    ];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0].pontosIndividuais).toEqual({ a1: 1000 });
  });

  it('o bônus tem o multiplicador da partida', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service } = cenario(teams, { multiplicador: 2 });
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0].pontosIndividuais).toEqual({ a1: 2000 });
    expect(teams[0].logIndividual.a1[0].descricao).toContain('(×2)');
  });

  it('letra certa: +300 a quem chutou, só no fechamento da rodada', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await service.chutarLetra('a2', 'm1', 'Z', 'DICA'); // e1 fecha
    // Antes do reveal o doc da equipe não pode dizer se a letra estava certa.
    expect(teams[0].pontosIndividuais ?? {}).toEqual({});
    await service.chutarLetra('b1', 'm1', 'R', 'DICA'); // rodada fecha
    expect(teams[0].pontosIndividuais).toEqual({ a1: 300 });
    expect(teams[1].pontosIndividuais).toEqual({ b1: 300 });
    expect(teams[0].logIndividual.a1).toEqual([
      expect.objectContaining({
        fonte: 'ACERTO_LETRA',
        pontos: 300,
        rodada: 1,
      }),
    ]);
  });

  it('a mesma letra certa em duas equipes rende para as duas', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await service.chutarLetra('b1', 'm1', 'A', 'DICA');
    expect(teams[0].pontosIndividuais).toEqual({ a1: 300 });
    expect(teams[1].pontosIndividuais).toEqual({ b1: 300 });
  });

  it('letra certa de equipe que caiu rende; letra descartada pela onda acabar, não', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1', 'b2'], { hp: 100 }),
      equipe('e3', ['c1', 'c2']),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e1');
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2'); // derruba e2
    await service.chutarLetra('c1', 'm1', 'T', 'DICA'); // pendente
    await service.arriscar('c2', 'm1', 'arte'); // a onda acaba
    expect(teams[1].pontosIndividuais).toEqual({ b1: 300 }); // caiu, mas acertou
    expect(teams[0].pontosIndividuais).toEqual({ a1: 300 });
    expect(teams[2].pontosIndividuais).toEqual({ c2: 1000 }); // c1 descartado
  });

  it('crédito da não campeã: equipe ×0,5 + bônus inteiro, e o log soma igual (exemplo Ana/Bia)', async () => {
    const teams = [
      equipe('e1', ['c1'], { pontos: 5000 }),
      equipe('e2', ['ana', 'bia'], {
        hp: 0,
        isHorde: true,
        pontos: 800,
        logPontos: [{ rodada: 1, fonte: 'DANO', descricao: 'x', pontos: 800 }],
        pontosIndividuais: { ana: 1600 },
        logIndividual: {
          ana: [
            {
              rodada: 1,
              fonte: 'ACERTO_PALAVRA',
              descricao: 'x',
              pontos: 1600,
            },
          ],
        },
      }),
    ];
    const { service, creditos, match } = cenario(teams, ultimaOnda);
    await service.chutarLetra('c1', 'm1', 'I', 'DICA'); // completa REI
    await service.arriscar('ana', 'm1', 'xyz');
    await service.arriscar('bia', 'm1', 'xyz'); // rodada fecha → encerra

    expect(match.vencedorEquipeId).toBe('e1');
    const de = (id: string) =>
      creditos[0].pontos.find((c) => c.alunoId === id)!.pontos;
    expect(de('bia')).toBe(400); // 800 × 0,5
    expect(de('ana')).toBe(2000); // 400 + 1600
    const ana = match.logPontuacao!.find((l) => l.alunoId === 'ana')!;
    expect(ana.totalPartida).toBe(2400);
    expect(ana.creditoRanking).toBe(2000);
    expect(ana.itens.reduce((s, i) => s + i.pontos, 0)).toBe(2000);
    expect(ana.itens.at(-1)?.fonte).toBe('ACERTO_PALAVRA');
    const bia = match.logPontuacao!.find((l) => l.alunoId === 'bia')!;
    expect(bia.itens.some((i) => i.fonte === 'ACERTO_PALAVRA')).toBe(false);
  });

  it('partida casual: o bônus aparece no log, sem crédito', async () => {
    const teams = [
      equipe('e1', ['a1'], { pontosIndividuais: { a1: 300 } }),
      equipe('e2', ['b1']),
    ];
    const { service, creditos, match } = cenario(teams, {
      ...ultimaOnda,
      valeRanking: false,
    });
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(creditos).toHaveLength(0);
    const a1 = match.logPontuacao!.find((l) => l.alunoId === 'a1')!;
    expect(a1.itens.some((i) => i.fonte === 'ACERTO_LETRA')).toBe(true);
    expect(a1.creditoRanking).toBe(0);
  });
});
