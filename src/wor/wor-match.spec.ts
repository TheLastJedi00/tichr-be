import { WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorMatchService } from './wor-match.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';

describe('Tichr Wor — partida (Fase 3)', () => {
  describe('WorMatchEntity', () => {
    it('normaliza letras (maiúscula, sem acento)', () => {
      expect(WorMatchEntity.normalizar('á')).toBe('A');
      expect(WorMatchEntity.normalizar('ç')).toBe('C');
    });

    it('mascara ocultando letras e preservando espaços', () => {
      const m = WorMatchEntity.mascarar('REI ARTUR', new Set(['R']));
      expect(m).toEqual(['R', '_', '_', ' ', '_', 'R', '_', '_', 'R']);
      expect(WorMatchEntity.estaCompleta(m)).toBe(false);
    });

    it('detecta palavra completa', () => {
      const m = WorMatchEntity.mascarar('REI', new Set(['R', 'E', 'I']));
      expect(WorMatchEntity.estaCompleta(m)).toBe(true);
    });

    it('revela todas as ocorrências de uma letra (acento normalizado)', () => {
      const m = WorMatchEntity.mascarar('ÁRVORE', new Set(['R']));
      // Á oculto, R revelado (2x), demais ocultos
      expect(m).toEqual(['_', 'R', '_', '_', 'R', '_']);
    });
  });

  describe('WorTeamEntity', () => {
    it('aplica dano até 0 e vira Horda ao cair', () => {
      const t = new WorTeamEntity({ id: 'a', hp: 10, isHorde: false });
      expect(t.aplicarDano(5)).toBe(false);
      expect(t.hp).toBe(5);
      expect(t.aplicarDano(20)).toBe(true); // caiu agora
      expect(t.hp).toBe(0);
      expect(t.isHorde).toBe(true);
      expect(t.aplicarDano(5)).toBe(false); // já era horda
    });

    it('cura respeitando o teto de 100', () => {
      const t = new WorTeamEntity({ id: 'a', hp: 80 });
      t.curar(40);
      expect(t.hp).toBe(100);
    });
  });

  describe('WorMatchService.distribuir', () => {
    it('cria N equipes e distribui os inscritos em round-robin', async () => {
      const match = new WorMatchEntity({
        id: 'm1',
        professorId: 'p1',
        status: 'LOBBY',
        inscritos: [
          { alunoId: 'a1', nome: 'A' },
          { alunoId: 'a2', nome: 'B' },
          { alunoId: 'a3', nome: 'C' },
        ],
      });
      const criados: Array<{ teamId: string; membros: unknown[] }> = [];
      const repo = {
        buscar: jest.fn().mockResolvedValue(match),
        criarTeam: jest.fn((_m: string, teamId: string, data: { membros: unknown[] }) => {
          criados.push({ teamId, membros: data.membros });
          return Promise.resolve({});
        }),
        atualizar: jest.fn().mockResolvedValue(undefined),
        listarTeams: jest.fn().mockResolvedValue([]),
      } as unknown as WorMatchRepository;

      const service = new WorMatchService(
        {} as WorJogoRepository,
        repo,
      );
      await service.distribuir('p1', 'm1', 2);

      expect(criados).toHaveLength(2);
      const total = criados.reduce((s, c) => s + c.membros.length, 0);
      expect(total).toBe(3); // todos os inscritos distribuídos
      expect(repo.atualizar).toHaveBeenCalledWith('m1', {
        ordemEquipes: ['equipe-1', 'equipe-2'],
      });
    });

    it('rejeita menos de 2 equipes', async () => {
      const match = new WorMatchEntity({ id: 'm1', professorId: 'p1', status: 'LOBBY', inscritos: [] });
      const repo = { buscar: jest.fn().mockResolvedValue(match) } as unknown as WorMatchRepository;
      const service = new WorMatchService({} as WorJogoRepository, repo);
      await expect(service.distribuir('p1', 'm1', 1)).rejects.toThrow();
    });
  });
});
