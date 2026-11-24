import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoEntity } from '../turma/entities/aluno.entity';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { PerguntaMensagemEntity } from './entities/pergunta-mensagem.entity';
import { PerguntaEntity } from './entities/pergunta.entity';
import { PerguntaMensagemRepository } from './pergunta-mensagem.repository';
import { PerguntaRepository } from './pergunta.repository';
import { PerguntaService } from './pergunta.service';

/**
 * Spec 037 — perguntas ao professor. O que importa travar:
 * - a janela da turma: fechada, o aluno só lê (#3);
 * - a privacidade: ninguém além do autor e do professor dono enxerga (#10, #11);
 * - os limites e o status da conversa (#4–#8).
 */

const PROF = 'prof-1';
const TURMA = 't1';

function montar(opcoes: { abertas?: boolean; podeGamificar?: boolean } = {}) {
  const alunos: Record<string, AlunoEntity> = {
    a1: new AlunoEntity({ id: 'a1', turmaId: TURMA, nome: 'Ana' }),
    a2: new AlunoEntity({ id: 'a2', turmaId: TURMA, nome: 'Bruno' }),
    x9: new AlunoEntity({ id: 'x9', turmaId: 'outra', nome: 'Fora' }),
  };
  const perguntas = new Map<string, PerguntaEntity>();
  const mensagens = new Map<string, PerguntaMensagemEntity>();
  let seq = 0;

  const clonar = (p: PerguntaEntity) => new PerguntaEntity({ ...p });
  const perguntaRepo = {
    transacao: async <T>(fn: (tx: unknown) => Promise<T>) => fn(null),
    novoId: () => `q${++seq}`,
    findById: async (id: string) => {
      const p = perguntas.get(id);
      return p ? clonar(p) : null;
    },
    findBy: async (campo: keyof PerguntaEntity, valor: unknown) =>
      [...perguntas.values()].filter((p) => p[campo] === valor).map(clonar),
    lerNaTransacao: async (_tx: unknown, id: string) => {
      const p = perguntas.get(id);
      return p ? clonar(p) : null;
    },
    gravarNaTransacao: (_tx: unknown, p: PerguntaEntity) => {
      perguntas.set(p.id, clonar(p));
    },
    abertasDoProfessor: async (professorId: string) =>
      [...perguntas.values()]
        .filter((p) => p.professorId === professorId && p.status === 'ABERTA')
        .map(clonar),
  } as unknown as PerguntaRepository;

  const mensagemRepo = {
    novoId: () => `m${++seq}`,
    gravarNaTransacao: (_tx: unknown, m: PerguntaMensagemEntity) => {
      mensagens.set(m.id, new PerguntaMensagemEntity({ ...m }));
    },
    daPergunta: async (perguntaId: string) =>
      [...mensagens.values()]
        .filter((m) => m.perguntaId === perguntaId)
        .sort(
          (a, b) =>
            a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id),
        ),
    findById: async (id: string) => mensagens.get(id) ?? null,
  } as unknown as PerguntaMensagemRepository;

  const turmas: Record<string, Record<string, unknown>> = {
    [TURMA]: {
      id: TURMA,
      professorId: PROF,
      perguntasAbertas: opcoes.abertas ?? true,
      perguntasAbertasDesde:
        (opcoes.abertas ?? true) ? '2026-11-24T13:00:00.000Z' : undefined,
    },
    outra: { id: 'outra', professorId: 'prof-2' },
  };
  const turmaRepo = {
    findById: async (id: string) => (turmas[id] ? { ...turmas[id] } : null),
    update: async (id: string, patch: Record<string, unknown>) => {
      Object.assign(turmas[id], patch);
    },
  } as unknown as TurmaRepository;

  const alunoRepo = {
    findById: async (id: string) => alunos[id] ?? null,
    findByTurma: async (t: string) =>
      Object.values(alunos).filter((a) => a.turmaId === t),
  } as unknown as AlunoRepository;

  const professorService = {
    getProfile: async () => ({ podeGamificar: opcoes.podeGamificar ?? true }),
  } as unknown as ProfessorService;

  const service = new PerguntaService(
    perguntaRepo,
    mensagemRepo,
    turmaRepo,
    alunoRepo,
    professorService,
  );
  return { service, perguntas, mensagens, turmas };
}

describe('PerguntaService — janela (#1–#3)', () => {
  it('turma sem o campo começa fechada', async () => {
    const { service, turmas } = montar();
    delete turmas[TURMA].perguntasAbertas;
    expect(await service.estadoJanela(PROF, TURMA)).toEqual({
      abertas: false,
      desde: null,
    });
  });

  it('abrir grava o "desde"; abrir de novo mantém o original', async () => {
    const { service, turmas } = montar({ abertas: false });
    const r = await service.abrirJanela(PROF, TURMA);
    expect(r.abertas).toBe(true);
    expect(turmas[TURMA].perguntasAbertasDesde).toBe(r.desde);
    const de = r.desde;
    expect((await service.abrirJanela(PROF, TURMA)).desde).toBe(de);
  });

  it('fechar limpa o "desde"', async () => {
    const { service, turmas } = montar();
    expect(await service.fecharJanela(PROF, TURMA)).toEqual({
      abertas: false,
      desde: null,
    });
    expect(turmas[TURMA].perguntasAbertas).toBe(false);
    expect(turmas[TURMA].perguntasAbertasDesde).toBeNull();
  });

  it('turma de outro professor: 404', async () => {
    const { service } = montar();
    await expect(service.abrirJanela(PROF, 'outra')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('fora do PhD: 403', async () => {
    const { service } = montar({ podeGamificar: false });
    await expect(service.estadoJanela(PROF, TURMA)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
