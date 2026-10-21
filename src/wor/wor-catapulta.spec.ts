import { BadRequestException } from '@nestjs/common';
import { WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

/**
 * O Risco Heroico com escolha: acertar a palavra inteira dá à equipe comum
 * Recuperar HP (a Cura Massiva de sempre) ou a Catapulta num castelo rival.
 * A palavra da onda 0 é ARTE.
 */
function cenario(teams: WorTeamEntity[]) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams), teams);
}

const time = (
  id: string,
  nome: string,
  membros: string[],
  hp: number = WOR.HP_INICIAL,
  isHorde = false,
) =>
  new WorTeamEntity({
    id,
    nome,
    hp,
    isHorde,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

const hp = (teams: WorTeamEntity[], id: string) =>
  teams.find((t) => t.id === id)!.hp;

describe('Tichr Wor — Catapulta: validação antes do palpite', () => {
  it('a Catapulta vale 300 de dano', () => {
    expect(WOR.DANO_CATAPULTA).toBe(300);
  });

  it('Catapulta sem alvo é recusada — e a tentativa NÃO é consumida', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await expect(
      service.arriscar('a1', 'm1', 'arte', { efeito: 'CATAPULTA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(match.jaAgiram).toEqual([]);
    expect(match.ondaIndex).toBe(0);
  });

  it('Catapulta no próprio castelo é recusada', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Catapulta numa Horda é recusada (não há castelo de pé para derrubar)', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1'], 0, true),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Catapulta num castelo inexistente é recusada', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-9',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a Horda que envia efeito é ignorada: continua sendo Usurpação', async () => {
    const teams = [
      time('equipe-1', 'Bárbaros', ['a1'], 0, true),
      time('equipe-2', 'Grifos', ['b1'], 800),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });
    expect(match.lastGlobalAction?.tipo).toBe('USURPACAO');
    expect(hp(teams, 'equipe-1')).toBe(800); // tomou o castelo do líder
  });
});

describe('Tichr Wor — Risco Heroico: Recuperar HP × Catapulta', () => {
  it('Recuperar HP (padrão, sem efeito enviado) cura como sempre', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1'], 500),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');

    expect(hp(teams, 'equipe-1')).toBe(500 + WOR.CURA_MASSIVA);
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(match.lastGlobalAction?.tipo).toBe('CURA');
  });

  it('Catapulta: 300 no rival escolhido, pontos de dano + bônus, card para todos e a onda avança', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1'], 500),
      time('equipe-2', 'Grifos', ['b1']),
      time('equipe-3', 'Fênix', ['c1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-3',
    });

    expect(hp(teams, 'equipe-3')).toBe(WOR.HP_INICIAL - WOR.DANO_CATAPULTA);
    expect(hp(teams, 'equipe-1')).toBe(500); // não cura
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(teams.find((t) => t.id === 'equipe-1')!.pontos).toBe(
      WOR.BONUS_ARRISCAR + WOR.DANO_CATAPULTA * WOR.PONTOS_POR_DANO,
    );
    expect(match.lastGlobalAction?.tipo).toBe('CATAPULTA');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A1 acertou a palavra e disparou a Catapulta! O castelo da Fênix sofreu 300 de dano!',
    );
    // O card chega a todas as equipes (o aluno só escuta o doc da sua).
    for (const t of teams) {
      expect(t.lastGlobalAction?.tipo).toBe('CATAPULTA');
    }
    expect(match.ondaIndex).toBe(1);
    // O placar da raiz reflete o HP novo.
    expect(match.placar?.find((p) => p.id === 'equipe-3')?.hp).toBe(
      WOR.HP_INICIAL - WOR.DANO_CATAPULTA,
    );
  });

  it('Catapulta que zera o HP derruba o castelo: o rival vira Horda', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1'], 200),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });

    const grifos = teams.find((t) => t.id === 'equipe-2')!;
    expect(grifos.hp).toBe(0);
    expect(grifos.isHorde).toBe(true);
    expect(match.lastGlobalAction?.mensagem).toContain('e caiu!');
    // O dano que vira ponto é o que de fato saiu do castelo.
    expect(teams.find((t) => t.id === 'equipe-1')!.pontos).toBe(
      WOR.BONUS_ARRISCAR + 200 * WOR.PONTOS_POR_DANO,
    );
  });

  it('errar a palavra ignora a Catapulta: Dano Crítico no próprio castelo, alvo intacto', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'rainha', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });

    expect(hp(teams, 'equipe-1')).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO);
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(match.lastGlobalAction).toBeUndefined();
    expect(match.feedRodada[0]?.tipo).toBe('DANO_CRITICO');
  });
});
