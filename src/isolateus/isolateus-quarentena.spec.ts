import { ForbiddenException } from '@nestjs/common';
import { XpService } from '../turma/xp.service';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { SETORES } from './isolateus.data';

/** Vila em `RESULTADO_RODADA`, pronta para convocar a Quarentena. Alien = a1. */
function cenario(opts: { reais?: number; npcs?: number; setor?: string } = {}) {
  const nReais = opts.reais ?? 4;
  const nNpcs = opts.npcs ?? 0;
  // A vila inteira na Comunicacao: e de la que se convoca a Quarentena, e
  // estes testes exercitam o fluxo da reuniao, nao a geografia (que tem specs
  // proprias em isolateus-mapa.spec).
  const setor = opts.setor ?? 'comunicacao';

  const habitantes: Habitante[] = [];
  const vinculos: Array<{ habitanteId: string; alunoId?: string }> = [];
  for (let i = 1; i <= nReais; i++) {
    habitantes.push({ id: `h${i}`, nome: `Real ${i}`, vivo: true, preso: false, setorId: setor });
    vinculos.push({ habitanteId: `h${i}`, alunoId: `a${i}` });
  }
  for (let i = 1; i <= nNpcs; i++) {
    habitantes.push({ id: `n${i}`, nome: `NPC ${i}`, vivo: true, preso: false, setorId: setor });
    vinculos.push({ habitanteId: `n${i}` });
  }

  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status: 'RESULTADO_RODADA',
    criadaEm: new Date().toISOString(),
    esperanca: ISOLATEUS.ESPERANCA_INICIAL,
    setores: SETORES.map((s) => ({ ...s, intacto: true })),
    habitantes,
    rodada: 0,
    totalRodadas: 10,
    duracaoSegundos: 60,
    faseIniciadaEm: null,
    questaoPublica: null,
    corretaIndex: 1,
    alerta: null,
    rumores: [],
    debate: [],
    resumoRodada: null,
    quarentenaRodada: null,
    vereditoQuarentena: null,
    votosRecebidos: 0,
    pulosRecebidos: 0,
    inscritos: [],
    veredito: null,
    rankingFinal: [],
  });

  const segredo = new IsolateusSegredoEntity({
    id: 'p1',
    partidaId: 'p1',
    alienAlunoId: 'a1',
    vinculos,
    acaoRodada: null,
    pulosDebate: [],
    pontos: {},
  });

  // Os votos são por rodada: o fake guarda a rodada e filtra, como o Firestore.
  const votos: Array<{ rodada: number; alunoId: string; suspeitoId: string }> = [];
  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    registrarVoto: jest.fn(
      async (_id, rodada: number, alunoId: string, suspeitoId: string) => {
        if (votos.some((v) => v.rodada === rodada && v.alunoId === alunoId)) {
          return false;
        }
        votos.push({ rodada, alunoId, suspeitoId });
        return true;
      },
    ),
    lerVotos: jest.fn(async (_id, rodada: number) =>
      votos.filter((v) => v.rodada === rodada),
    ),
    lerRespostas: jest.fn(async () => []),
  } as unknown as IsolateusMatchRepository;

  const jogos = {
    findById: jest.fn(async () => ({
      id: 'j1',
      questoes: [{ enunciado: 'Q', alternativas: ['a', 'b'], corretaIndex: 1 }],
    })),
  } as unknown as IsolateusJogoRepository;

  const creditar = jest.fn().mockResolvedValue(undefined);
  const xp = { creditarPartida: creditar } as unknown as XpService;

  return {
    service: new IsolateusGameService(repo, jogos, xp),
    partida,
    segredo,
    creditar,
  };
}

describe('Isolateus — a Quarentena', () => {
  it('qualquer habitante real vivo convoca, e só entre as rodadas', async () => {
    const { service, partida } = cenario();
    await service.convocarQuarentena('p1', { alunoId: 'a2' });

    expect(partida.status).toBe('QUARENTENA_DEBATE');
    expect(partida.quarentenaRodada).toBe(partida.rodada);
    expect(partida.faseIniciadaEm).not.toBeNull();
    expect(partida.debate.length).toBeGreaterThan(0); // os NPCs já acusam
  });

  it('é uma por rodada — a vila não encadeia convocações na mesma rodada', async () => {
    const { service, partida } = cenario();
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'RESULTADO_RODADA'; // voltou de um veredito de inocente

    await expect(
      service.convocarQuarentena('p1', { alunoId: 'a3' }),
    ).rejects.toMatchObject({ response: { code: 'QUARENTENA_USADA' } });
  });

  it('a opção volta na rodada seguinte — a Quarentena não é única por partida', async () => {
    const { service, partida } = cenario();
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'RESULTADO_RODADA';
    partida.rodada = 1; // a noite passou

    await service.convocarQuarentena('p1', { alunoId: 'a3' });
    expect(partida.status).toBe('QUARENTENA_DEBATE');
    expect(partida.quarentenaRodada).toBe(1);
    expect(partida.vereditoQuarentena).toBeNull(); // nasce limpa
  });

  it('os votos são por rodada: a Quarentena nova não reaproveita os votos da anterior', async () => {
    const { service, partida } = cenario({ reais: 4 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'QUARENTENA_VOTO';
    await service.votarSuspeito('a2', 'p1', 'h3');
    expect(partida.votosRecebidos).toBe(1);

    partida.status = 'RESULTADO_RODADA';
    partida.rodada = 1;
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    expect(partida.votosRecebidos).toBe(0);

    // O mesmo aluno vota de novo: na rodada nova, o voto antigo não o trava.
    partida.status = 'QUARENTENA_VOTO';
    await expect(service.votarSuspeito('a2', 'p1', 'h4')).resolves.toEqual({
      registrado: true,
    });
    expect(partida.votosRecebidos).toBe(1);
  });

  it('quem saiu da vila não convoca, não debate e não vota', async () => {
    const { service, partida } = cenario();
    partida.habitantes.find((h) => h.id === 'h4')!.vivo = false;

    await expect(
      service.convocarQuarentena('p1', { alunoId: 'a4' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    await expect(
      service.debater('a4', 'p1', 'foi o Real 1!'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o debate publica o pseudônimo, nunca o nome real do aluno', async () => {
    const { service, partida } = cenario();
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    await service.debater('a2', 'p1', 'O Real 1 concordou com o rumor.');

    const minha = partida.debate.at(-1)!;
    expect(minha.autorNome).toBe('Real 2'); // o pseudônimo do habitante
    // Nenhum autor do debate é um alunoId — o Voto de Silêncio vale no chat.
    const alunoIds = ['a1', 'a2', 'a3', 'a4'];
    for (const msg of partida.debate) {
      expect(alunoIds).not.toContain(msg.autorNome);
    }
  });

  it('pular o debate: só abre a votação quando TODOS os reais na vila pulam', async () => {
    const { service, partida } = cenario({ reais: 3, npcs: 2 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });

    await service.pularDebate('a1', 'p1');
    expect(partida.pulosRecebidos).toBe(1);
    expect(partida.status).toBe('QUARENTENA_DEBATE'); // os NPCs não contam

    await service.pularDebate('a2', 'p1');
    expect(partida.status).toBe('QUARENTENA_DEBATE');

    await service.pularDebate('a3', 'p1');
    expect(partida.pulosRecebidos).toBe(3);
    expect(partida.status).toBe('QUARENTENA_VOTO'); // avanço rápido
  });

  it('pular duas vezes não conta dobrado nem antecipa a votação', async () => {
    const { service, partida } = cenario({ reais: 2 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });

    await service.pularDebate('a1', 'p1');
    await service.pularDebate('a1', 'p1');
    expect(partida.pulosRecebidos).toBe(1);
    expect(partida.status).toBe('QUARENTENA_DEBATE');
  });

  it('quem saiu da vila não conta para o pulo — a votação abre sem ele', async () => {
    const { service, partida } = cenario({ reais: 3 });
    partida.habitantes.find((h) => h.id === 'h3')!.vivo = false; // abduzido
    await service.convocarQuarentena('p1', { alunoId: 'a2' });

    await expect(service.pularDebate('a3', 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Os 2 que sobraram bastam: o abduzido não entra na conta.
    await service.pularDebate('a1', 'p1');
    await service.pularDebate('a2', 'p1');
    expect(partida.pulosRecebidos).toBe(2);
    expect(partida.status).toBe('QUARENTENA_VOTO');
  });

  it('a contagem de pulos não denuncia quem pulou (a lista fica no cofre)', async () => {
    const { service, partida, segredo } = cenario({ reais: 2 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    await service.pularDebate('a1', 'p1');

    expect(partida.pulosRecebidos).toBe(1);
    expect(segredo.pulosDebate).toEqual(['a1']);
    // A camada pública não carrega nenhum alunoId. Com as aspas: sem elas, a
    // busca casa com qualquer UUID que contenha "a1" (ex.: 2f166a17-…), e o
    // teste falha ao acaso. Mesmo idioma de isolateus-match.spec.
    expect(JSON.stringify(partida)).not.toContain('"a1"');
  });

  it('a vila prende a Ameaça: partida encerrada com vitória da Vila', async () => {
    const { service, partida, segredo, creditar } = cenario({ reais: 4 });
    segredo.pontos = { a2: 500 };
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'QUARENTENA_VOTO';

    // Todos votam no h1 (o Alien) — o avanço rápido apura no último voto.
    for (const aluno of ['a1', 'a2', 'a3', 'a4']) {
      await service.votarSuspeito(aluno, 'p1', 'h1');
    }

    expect(partida.vereditoQuarentena?.eraAmeaca).toBe(true);
    expect(partida.status).toBe('ENCERRADO');
    expect(partida.veredito?.lado).toBe('VILA');
    expect(partida.veredito?.motivo).toContain('trancaram o Alienígena');

    // Aldeões levam o bônus de vitória; o Alien não.
    const a2 = partida.rankingFinal.find((p) => p.alunoId === 'a2')!;
    expect(a2.pontos).toBe(500 + ISOLATEUS.BONUS_VITORIA);
    expect(creditar).toHaveBeenCalledWith(
      't1',
      expect.anything(),
      'ISOLATEUS',
    );
  });

  it('a vila prende um inocente: -20 de Esperança e a identidade dele fica em segredo', async () => {
    const { service, partida } = cenario({ reais: 4 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'QUARENTENA_VOTO';

    for (const aluno of ['a1', 'a2', 'a3', 'a4']) {
      await service.votarSuspeito(aluno, 'p1', 'h3'); // h3 é inocente
    }

    expect(partida.vereditoQuarentena?.eraAmeaca).toBe(false);
    expect(partida.habitantes.find((h) => h.id === 'h3')!.preso).toBe(true);
    expect(partida.esperanca).toBe(100 - ISOLATEUS.DANO_INOCENTE);
    // O jogo continua e a Ameaça segue solta.
    expect(partida.status).toBe('RESULTADO_RODADA');
    // O veredito não diz se o preso era NPC ou aluno real (§5).
    const texto = partida.vereditoQuarentena!.texto;
    expect(texto).toContain('INOCENTE');
    expect(texto).not.toMatch(/NPC|virtual|bot/i);
  });

  it('prender inocente com a Esperança no limite entrega a partida à Ameaça', async () => {
    const { service, partida } = cenario({ reais: 4 });
    partida.esperanca = ISOLATEUS.DANO_INOCENTE;
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'QUARENTENA_VOTO';

    for (const aluno of ['a1', 'a2', 'a3', 'a4']) {
      await service.votarSuspeito(aluno, 'p1', 'h3');
    }

    expect(partida.esperanca).toBe(0);
    expect(partida.status).toBe('ENCERRADO');
    expect(partida.veredito?.lado).toBe('AMEACA');
  });

  it('um voto por habitante — o segundo é ignorado', async () => {
    const { service, partida } = cenario({ reais: 4 });
    await service.convocarQuarentena('p1', { alunoId: 'a2' });
    partida.status = 'QUARENTENA_VOTO';

    expect(await service.votarSuspeito('a2', 'p1', 'h3')).toEqual({
      registrado: true,
    });
    expect(await service.votarSuspeito('a2', 'p1', 'h1')).toEqual({
      registrado: false,
    });
    expect(partida.votosRecebidos).toBe(1);
  });
});
