import { BadRequestException, NotFoundException } from '@nestjs/common';
import { XpService } from '../turma/xp.service';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
  StatusIsolateus,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { SETORES } from './isolateus.data';

const QUESTOES = Array.from({ length: 3 }, (_, i) => ({
  enunciado: `Q${i}`,
  alternativas: ['a', 'b', 'c', 'd'],
  corretaIndex: 1,
}));

/**
 * Uma vila parada numa fase cronometrada que acabou de começar — o relógio
 * está longe de zerar, então só o pulo do professor pode encerrá-la. Quatro
 * reais na Comunicação, sem NPCs (apuração determinística); o h1 é a Ameaça.
 */
function vila(status: StatusIsolateus) {
  const habitantes: Habitante[] = [];
  const vinculos: Array<{ habitanteId: string; alunoId?: string }> = [];
  for (let i = 1; i <= 4; i++) {
    habitantes.push({
      id: `h${i}`,
      nome: `Real ${i}`,
      vivo: true,
      preso: false,
      setorId: 'comunicacao',
    });
    vinculos.push({ habitanteId: `h${i}`, alunoId: `a${i}` });
  }

  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status,
    criadaEm: new Date().toISOString(),
    esperanca: ISOLATEUS.ESPERANCA_INICIAL,
    setores: SETORES.map((s) => ({ id: s.id, nome: s.nome, intacto: true })),
    habitantes,
    rodada: 0,
    questaoIndex: 0,
    reparoSetorId: null,
    totalRodadas: QUESTOES.length,
    duracaoSegundos: 60,
    faseIniciadaEm: status === 'LOBBY' ? null : new Date().toISOString(),
    questaoPublica:
      status === 'QUESTAO_ATIVA'
        ? { enunciado: 'Q0', alternativas: ['a', 'b', 'c', 'd'] }
        : null,
    corretaIndex: null,
    alerta: null,
    rumores: [],
    debate: [],
    resumoRodada: null,
    quarentenaRodada: status.startsWith('QUARENTENA') ? 0 : null,
    vereditoQuarentena: null,
    votosRecebidos: 0,
    pulosRecebidos: 0,
    movimentosRecebidos: 0,
    inscritos: [],
    veredito: null,
    rankingFinal: [],
  });

  const segredo = new IsolateusSegredoEntity({
    id: 'p1',
    partidaId: 'p1',
    alienAlunoId: 'a1',
    vinculos,
    acaoRodada:
      status === 'QUESTAO_ATIVA' ? { tipo: 'ABDUZIR', alvoId: 'h2' } : null,
    pulosDebate: [],
    confirmacoesNoite: [],
    pontos: {},
  });

  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    lerRespostas: jest.fn(async () => []),
    lerVotos: jest.fn(async () => []),
  } as unknown as IsolateusMatchRepository;

  const jogos = {
    findById: jest.fn(async () => ({ id: 'j1', questoes: QUESTOES })),
  } as unknown as IsolateusJogoRepository;
  const xp = {
    creditarPartida: jest.fn().mockResolvedValue(undefined),
  } as unknown as XpService;

  return { service: new IsolateusGameService(repo, jogos, xp), partida };
}

describe('Isolateus — o professor pula qualquer cronômetro', () => {
  it('noite: fecha o deslocamento na hora (a noite calma abre a janela de decisão)', async () => {
    const { service, partida } = vila('DESLOCAMENTO');
    await service.pularFase('prof', 'p1');
    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.faseIniciadaEm).not.toBeNull();
  });

  it('questão: apura com as respostas recebidas até ali', async () => {
    const { service, partida } = vila('QUESTAO_ATIVA');
    await service.pularFase('prof', 'p1');
    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.corretaIndex).toBe(1);
    expect(partida.questaoIndex).toBe(1);
  });

  it('janela de decisão: a noite seguinte cai (o antigo "Adiantar noite")', async () => {
    const { service, partida } = vila('RESULTADO_RODADA');
    await service.pularFase('prof', 'p1');
    expect(partida.status).toBe('DESLOCAMENTO');
    expect(partida.rodada).toBe(1);
  });

  it('debate: o pulo do professor vale pela unanimidade e abre a votação', async () => {
    const { service, partida } = vila('QUARENTENA_DEBATE');
    await service.pularFase('prof', 'p1');
    expect(partida.pulosRecebidos).toBe(0); // nenhum aluno pulou
    expect(partida.status).toBe('QUARENTENA_VOTO');
  });

  it('votação: apura com os votos recebidos até ali', async () => {
    const { service, partida } = vila('QUARENTENA_VOTO');
    await service.pularFase('prof', 'p1');
    expect(partida.status).not.toBe('QUARENTENA_VOTO');
    expect(partida.vereditoQuarentena).not.toBeNull();
  });

  it('o clique atrasado não pula duas fases: status diferente do exibido = sem efeito', async () => {
    const { service, partida } = vila('QUARENTENA_DEBATE');
    // O relógio (ou o último aluno) já abriu a votação antes do clique chegar.
    await service.pularFase('prof', 'p1', 'QUARENTENA_DEBATE');
    expect(partida.status).toBe('QUARENTENA_VOTO');

    await service.pularFase('prof', 'p1', 'QUARENTENA_DEBATE');
    expect(partida.status).toBe('QUARENTENA_VOTO');
    expect(partida.vereditoQuarentena).toBeNull();
  });

  it('fora de fase cronometrada é recusado', async () => {
    const { service } = vila('LOBBY');
    await expect(service.pularFase('prof', 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('só o dono da partida pula', async () => {
    const { service, partida } = vila('QUARENTENA_DEBATE');
    await expect(service.pularFase('outro', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(partida.status).toBe('QUARENTENA_DEBATE');
  });
});
