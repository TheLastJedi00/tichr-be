import { WorJogoEntity } from './entities/wor-jogo.entity';
import { WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoService } from './wor-jogo.service';
import { fakeWor, partidaTeste } from './wor.fake';

/**
 * Palavra repetida no arsenal (lotes da IA somados, ou digitada duas vezes):
 * acertar encerra a onda, mas a seguinte trazia a MESMA palavra — e quem já
 * sabia a resposta disparava a Catapulta de novo, uma vez por cópia.
 */
const time = (id: string, membros: string[]) =>
  new WorTeamEntity({
    id,
    nome: id,
    hp: WOR.HP_INICIAL,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

const JOGO_REPETIDO = new WorJogoEntity({
  id: 'j1',
  palavras: [
    { id: 'w1', palavra: 'ARTE', dicas: ['d1'] },
    { id: 'w2', palavra: ' arte ', dicas: ['d2'] },
    { id: 'w3', palavra: 'Árte', dicas: ['d3'] },
    { id: 'w4', palavra: 'REI', dicas: ['x1'] },
  ],
});

describe('Tichr Wor — palavra repetida no arsenal', () => {
  it('as ondas ignoram as cópias (mesma palavra sem acento/caixa/espaço)', () => {
    expect(JOGO_REPETIDO.ondas.map((p) => p.id)).toEqual(['w1', 'w4']);
  });

  it('acertar a palavra pula as cópias: a próxima onda é outra palavra', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service, match } = fakeWor(
      JOGO_REPETIDO,
      partidaTeste(teams, { totalOndas: 2 }),
      teams,
    );

    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });
    expect(match.ondaIndex).toBe(1);
    expect(match.mascara).toEqual(['_', '_', '_']);

    // A mesma resposta não vale de novo: vira erro (Dano Crítico), não Catapulta.
    await service.arriscar('b1', 'm1', 'arte');
    expect(teams.find((t) => t.id === 'equipe-1')!.hp).toBe(WOR.HP_INICIAL);
    expect(teams.find((t) => t.id === 'equipe-2')!.hp).toBe(
      WOR.HP_INICIAL - WOR.DANO_CATAPULTA - WOR.DANO_CRITICO,
    );
  });

  it('salvar o arsenal descarta as cópias', () => {
    const r = WorJogoService.normalizarPalavras([
      { palavra: 'Arte', dicas: ['a'] },
      { palavra: 'ARTE ', dicas: ['b'] },
      { palavra: 'rei' },
    ]);
    expect(r.map((p) => p.palavra)).toEqual(['Arte', 'rei']);
  });
});
