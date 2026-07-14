import { BadRequestException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { IsolateusMatchEntity } from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { IsolateusMatchService } from './isolateus-match.service';

/** Repositório em memória: guarda a camada pública e o cofre separados. */
function repoFake() {
  const partidas = new Map<string, IsolateusMatchEntity>();
  const segredos = new Map<string, IsolateusSegredoEntity>();
  let seq = 0;

  const repo = {
    criar: jest.fn(async (partida, segredo) => {
      const id = `p${++seq}`;
      const entidade = new IsolateusMatchEntity({ ...partida, id });
      partidas.set(id, entidade);
      segredos.set(
        id,
        new IsolateusSegredoEntity({ ...segredo, id, partidaId: id }),
      );
      return entidade;
    }),
    buscar: jest.fn(async (id: string) => partidas.get(id) ?? null),
    buscarSegredo: jest.fn(async (id: string) => segredos.get(id) ?? null),
    commitPartida: jest.fn(async (id: string, publico = {}, segredo = {}) => {
      Object.assign(partidas.get(id)!, publico);
      Object.assign(segredos.get(id)!, segredo);
    }),
    ativaDaTurma: jest.fn(),
  } as unknown as IsolateusMatchRepository;

  return { repo, partidas, segredos };
}

function make(opts: { questoes?: number } = {}) {
  const { repo, partidas, segredos } = repoFake();
  const jogos = {
    findById: jest.fn(async () => ({
      id: 'j1',
      professorId: 'prof',
      nome: 'A Vila Isolada',
      duracaoSegundos: 60,
      turmas: ['t1'],
      questoes: Array.from({ length: opts.questoes ?? 10 }, (_, i) => ({
        enunciado: `Q${i}`,
        alternativas: ['a', 'b', 'c', 'd'],
        corretaIndex: 1,
      })),
    })),
  } as unknown as IsolateusJogoRepository;
  const turmas = {
    findById: jest.fn(async () => ({ id: 't1', professorId: 'prof' })),
  } as unknown as TurmaRepository;
  const professores = {
    getProfile: jest.fn(
      async () => new ProfessorEntity({ uid: 'prof', planoAtual: 'PHD' }),
    ),
  } as unknown as ProfessorService;

  const service = new IsolateusMatchService(repo, jogos, turmas, professores);
  return { service, repo, partidas, segredos };
}

/** Entra com N alunos no lobby. */
async function povoar(service: IsolateusMatchService, id: string, n: number) {
  for (let i = 1; i <= n; i++) {
    await service.entrar(`a${i}`, 't1', id, `Habitante ${i}`);
  }
}

describe('Isolateus — lobby e Despertar', () => {
  it('recusa pseudônimo já adotado por outro habitante', async () => {
    const { service } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await service.entrar('a1', 't1', p.id, 'Corvo');
    await expect(
      service.entrar('a2', 't1', p.id, ' corvo '),
    ).rejects.toMatchObject({ response: { code: 'NOME_EM_USO' } });
  });

  it('reentrar troca o próprio pseudônimo sem duplicar o inscrito', async () => {
    const { service, partidas } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await service.entrar('a1', 't1', p.id, 'Corvo');
    await service.entrar('a1', 't1', p.id, 'Ferreiro');
    expect(partidas.get(p.id)!.inscritos).toEqual([
      { alunoId: 'a1', nome: 'Ferreiro' },
    ]);
  });

  it('o veto do professor devolve o aluno para a tela de registro', async () => {
    const { service, partidas } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 2);
    await service.vetarNome('prof', p.id, 'a1');
    expect(partidas.get(p.id)!.inscritos.map((i) => i.alunoId)).toEqual(['a2']);
  });

  it('não inicia com menos de 4 investigadores reais', async () => {
    const { service } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 3);
    await expect(service.iniciar('prof', p.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('4 reais → 3 NPCs (Névoa de Guerra = reais - 1)', async () => {
    const { service, partidas, segredos } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 4);
    await service.iniciar('prof', p.id);

    expect(partidas.get(p.id)!.habitantes).toHaveLength(7);
    expect(segredos.get(p.id)!.npcIds).toHaveLength(3);
    expect(segredos.get(p.id)!.reaisIds).toHaveLength(4);
  });

  it('10 reais → nenhum NPC (a vila já é grande o bastante)', async () => {
    const { service, partidas, segredos } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 10);
    await service.iniciar('prof', p.id);

    expect(partidas.get(p.id)!.habitantes).toHaveLength(10);
    expect(segredos.get(p.id)!.npcIds).toHaveLength(0);
  });

  it('a Ameaça é sempre um habitante real, nunca um NPC', async () => {
    for (let tentativa = 0; tentativa < 20; tentativa++) {
      const { service, segredos } = make();
      const p = await service.criar('prof', 'j1', 't1');
      await povoar(service, p.id, 5);
      await service.iniciar('prof', p.id);

      const segredo = segredos.get(p.id)!;
      expect(segredo.alienAlunoId).toMatch(/^a[1-5]$/);
      // O habitante do Alien existe e está entre os reais.
      const habitanteAlien = segredo.habitanteDe(segredo.alienAlunoId);
      expect(segredo.reaisIds).toContain(habitanteAlien);
    }
  });

  it('a camada pública não entrega o Alien, os NPCs nem o vínculo aluno↔pseudônimo', async () => {
    const { service, partidas } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 6);
    await service.iniciar('prof', p.id);

    const publico = partidas.get(p.id)!;
    const json = JSON.stringify(publico);

    // Nenhum campo secreto vazou no doc que o cliente lê via onSnapshot.
    expect(json).not.toContain('alienAlunoId');
    expect(json).not.toContain('vinculos');
    expect(json).not.toContain('npc');
    // A lista de inscritos (alunoId ↔ pseudônimo) é apagada ao iniciar: mantida,
    // permitiria casar nomes e deduzir quem é NPC por eliminação.
    expect(publico.inscritos).toEqual([]);
    expect(json).not.toContain('"a1"');
    // Os habitantes têm id opaco e são indistinguíveis entre si.
    for (const h of publico.habitantes) {
      expect(Object.keys(h).sort()).toEqual(['id', 'nome', 'preso', 'vivo']);
      expect(h.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('a vila começa intacta: 100 de Esperança e 6 setores', async () => {
    const { service, partidas } = make();
    const p = await service.criar('prof', 'j1', 't1');
    await povoar(service, p.id, 4);
    await service.iniciar('prof', p.id);

    const publico = partidas.get(p.id)!;
    expect(publico.esperanca).toBe(100);
    expect(publico.setoresIntactos).toBe(6);
    expect(publico.status).toBe('TURNO_AMEACA');
    expect(publico.rodada).toBe(0);
    expect(publico.totalRodadas).toBe(10);
  });
});
