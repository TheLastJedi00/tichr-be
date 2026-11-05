import { ConflictException } from '@nestjs/common';
import { WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

/**
 * Spec 032 §2 — Wor por rodada. Todas as equipes seguem jogando em paralelo,
 * mas NADA acontece antes do fechamento: ataques, Catapulta, Recuperar HP,
 * Usurpação e o crítico do arriscar errado são calculados sobre o HP do início
 * do fechamento e aplicados de uma vez. "Arriscar" vale uma vez por equipe por
 * rodada, e acertar a palavra não encerra a onda na hora.
 * A palavra da onda 0 é ARTE (A, R, T, E).
 */
const time = (
  id: string,
  membros: string[],
  hp: number = WOR.HP_INICIAL,
  isHorde = false,
) =>
  new WorTeamEntity({
    id,
    nome: id.toUpperCase(),
    hp,
    isHorde,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

const hp = (teams: WorTeamEntity[], id: string) =>
  teams.find((t) => t.id === id)!.hp;
const team = (teams: WorTeamEntity[], id: string) =>
  teams.find((t) => t.id === id)!;

function cenario(teams: WorTeamEntity[]) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams), teams);
}

describe('Wor 032 — nada acontece antes do fechamento', () => {
  it('equipe que fecha não causa dano até a rodada fechar', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1', 'b2'])];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(hp(teams, 'e2')).toBe(1000);
    expect(match.equipesFechadas.map((f) => f.equipeId)).toEqual(['e1']);
    // o lado público não diz se a equipe vai atacar
    expect(match.equipesFechadas[0].resultado).toBe('JOGOU');
    expect(match.feedRodada.at(-1)?.tipo).toBe('JOGOU');

    await service.chutarLetra('b1', 'm1', 'X', 'DICA');
    await service.chutarLetra('b2', 'm1', 'Z', 'DICA');
    expect(hp(teams, 'e2')).toBe(900);
    expect(match.resumoRodada?.seq).toBe(1);
  });

  it('o arriscar errado só derruba HP no fechamento', async () => {
    const teams = [time('e1', ['a1', 'a2']), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'ERRADO');
    expect(hp(teams, 'e1')).toBe(1000);
    await service.chutarLetra('a2', 'm1', 'Q', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Q', 'DICA');
    expect(hp(teams, 'e1')).toBe(1000 - WOR.DANO_CRITICO);
  });
});

describe('Wor 032 — resolução simultânea', () => {
  it('castelo que cai na rodada ainda dá o golpe dela', async () => {
    const teams = [time('e1', ['a1'], 100), time('e2', ['b1'], 100)];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e1');

    expect(hp(teams, 'e1')).toBe(0);
    expect(hp(teams, 'e2')).toBe(0);
    expect(team(teams, 'e1').isHorde).toBe(true);
    expect(team(teams, 'e2').isHorde).toBe(true);
    const r = match.resumoRodada!.resultados;
    expect(r.map((x) => x.acao)).toEqual(['ATACAR', 'ATACAR']);
    expect(r.every((x) => x.caiu)).toBe(true);
  });

  it('cura e dano no mesmo castelo somam (líquido)', async () => {
    // e1 (300 HP) arrisca e acerta (Recuperar HP +400) e leva 100 de e2.
    const teams = [time('e1', ['a1'], 300), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e1');
    expect(hp(teams, 'e1')).toBe(300 + WOR.CURA_MASSIVA - WOR.DANO_ATAQUE);
  });

  it('dois ataques passando do HP: os pontos são o que de fato saiu, na ordem de chegada', async () => {
    const teams = [
      time('e1', ['a1']),
      time('e2', ['b1']),
      time('e3', ['c1'], 150),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e3');
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e3');
    await service.chutarLetra('c1', 'm1', 'Q', 'DICA');

    expect(hp(teams, 'e3')).toBe(0);
    expect(team(teams, 'e1').pontos).toBe(100);
    expect(team(teams, 'e2').pontos).toBe(50);
  });
});

describe('Wor 032 — arriscar uma vez por equipe por rodada', () => {
  it('o segundo arriscar da mesma equipe é 409; o colega ainda chuta letra', async () => {
    const teams = [time('e1', ['a1', 'a2', 'a3']), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'ERRADO');
    expect(team(teams, 'e1').arriscouNaRodada).toBe('a1');

    await expect(service.arriscar('a2', 'm1', 'arte')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.arriscar('a2', 'm1', 'arte')).rejects.toMatchObject({
      response: { code: 'ARRISCAR_USADO' },
    });
    await service.chutarLetra('a2', 'm1', 'A', 'DICA');
  });

  it('a trava zera na rodada seguinte', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'ERRADO');
    await service.chutarLetra('b1', 'm1', 'Q', 'DICA');
    expect(team(teams, 'e1').arriscouNaRodada ?? null).toBeNull();
    await service.arriscar('a1', 'm1', 'ERRADO');
  });

  it('na Horda, quem arriscou fecha pela equipe inteira (não sobra ação)', async () => {
    const teams = [
      time('e1', ['a1']),
      time('h', ['h1', 'h2', 'h3'], 0, true),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('h1', 'm1', 'ERRADO');
    expect(match.equipesFechadas.map((f) => f.equipeId)).toEqual(['h']);
  });
});

describe('Wor 032 — acertar a palavra', () => {
  it('não encerra a onda na hora: as outras equipes ainda jogam', async () => {
    const teams = [time('e1', ['a1'], 500), time('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(match.ondaIndex).toBe(0);
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e1');
    expect(match.ondaIndex).toBe(1);
    expect(hp(teams, 'e1')).toBe(500 + WOR.CURA_MASSIVA - WOR.DANO_ATAQUE);
  });

  it('cura não passa de 1000 nem com dano no mesmo fechamento', async () => {
    const teams = [time('e1', ['a1'], 950), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e1');
    expect(hp(teams, 'e1')).toBe(1000);
  });

  it('Catapulta no fechamento, com o bônus de arriscar e o pessoal', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'e2',
    });
    expect(hp(teams, 'e2')).toBe(1000);
    await service.chutarLetra('b1', 'm1', 'Q', 'DICA');
    expect(hp(teams, 'e2')).toBe(1000 - WOR.DANO_CATAPULTA);
    expect(team(teams, 'e1').pontos).toBe(
      WOR.DANO_CATAPULTA + WOR.BONUS_ARRISCAR,
    );
    expect(team(teams, 'e1').pontosIndividuais?.a1).toBe(
      WOR.BONUS_ACERTO_PALAVRA,
    );
  });

  it('duas equipes acertando na mesma rodada: as duas recebem o efeito', async () => {
    const teams = [time('e1', ['a1'], 500), time('e2', ['b1'], 500)];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    await service.arriscar('b1', 'm1', 'arte');
    expect(hp(teams, 'e1')).toBe(900);
    expect(hp(teams, 'e2')).toBe(900);
  });

  it('Horda que acerta usurpa o castelo de maior HP depois dos danos', async () => {
    const teams = [
      time('e1', ['a1'], 800),
      time('e2', ['b1'], 900),
      time('h', ['h1'], 0, true),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2'); // e2 → 800
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e1'); // e1 → 700
    await service.arriscar('h1', 'm1', 'arte');
    // depois dos danos o líder é e2 (800): a Horda fica com o castelo dele
    expect(hp(teams, 'h')).toBe(800);
    expect(team(teams, 'h').isHorde).toBe(false);
    expect(team(teams, 'e2').isHorde).toBe(true);
  });
});
