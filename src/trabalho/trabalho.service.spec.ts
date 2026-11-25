import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AnexoStorage } from '../common/anexo.storage';
import { ProfessorService } from '../professor/professor.service';
import { AlunoEntity } from '../turma/entities/aluno.entity';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { XpService } from '../turma/xp.service';
import { AtividadeRepository } from './atividade.repository';
import { AtividadeEntity } from './entities/atividade.entity';
import { EntregaEntity } from './entities/entrega.entity';
import { EntregaRepository } from './entrega.repository';
import { TrabalhoService } from './trabalho.service';

/**
 * Spec 038 — envio de trabalhos. O que importa travar:
 * - o prazo com hora e a edição até o prazo ou a avaliação (#10–#12);
 * - uma entrega por aluno e os contadores da atividade (#5, #6);
 * - a nota que vira XP pela diferença (#15–#17);
 * - a privacidade: só o autor e o professor dono (#19, #20).
 */

const PROF = 'prof-1';
const TURMA = 't1';
const FUTURO = '2099-12-05T23:59:00.000Z';
const PASSADO = '2020-01-01T10:00:00.000Z';
const PDF = Buffer.from('%PDF-1.4 conteudo');

function codigoDe(e: unknown): string | undefined {
  const r = (e as { getResponse?: () => unknown }).getResponse?.();
  return (r as { code?: string })?.code;
}

async function falha(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return codigoDe(e) ?? (e as Error).constructor.name;
  }
  throw new Error('era para falhar');
}

function montar(
  opcoes: { podeGamificar?: boolean; pontuacaoAtiva?: boolean } = {},
) {
  const alunos: Record<string, AlunoEntity> = {
    a1: new AlunoEntity({ id: 'a1', turmaId: TURMA, nome: 'Ana' }),
    a2: new AlunoEntity({ id: 'a2', turmaId: TURMA, nome: 'Bruno' }),
    x9: new AlunoEntity({ id: 'x9', turmaId: 'outra', nome: 'Fora' }),
  };
  const xp: Record<string, number> = { a1: 0, a2: 0, x9: 0 };
  const xpLogs: Array<{ alunoId: string; pontos: number; motivo: string }> = [];
  const atividades = new Map<string, AtividadeEntity>();
  const entregas = new Map<string, EntregaEntity>();
  let seq = 0;
  const ctl = { falharUpload: false, falharTx: false };

  const cloneA = (a: AtividadeEntity) => new AtividadeEntity({ ...a });
  const cloneE = (e: EntregaEntity) =>
    new EntregaEntity({
      ...e,
      arquivos: e.arquivos.map((x) => ({ ...x })),
      avaliacao: e.avaliacao ? { ...e.avaliacao } : e.avaliacao,
    });

  /** Grava só no fim, como o Firestore: se algo falha, nada muda. */
  const transacao = async <T>(fn: (tx: unknown) => Promise<T>) => {
    const escritas: Array<() => void> = [];
    const r = await fn(escritas);
    if (ctl.falharTx) throw new Error('conflito na transação');
    escritas.forEach((w) => w());
    return r;
  };

  const atividadeRepo = {
    transacao,
    create: async (dados: Omit<AtividadeEntity, 'id'>) => {
      const a = new AtividadeEntity({ ...dados, id: `at${++seq}` });
      atividades.set(a.id, cloneA(a));
      return cloneA(a);
    },
    findById: async (id: string) => {
      const a = atividades.get(id);
      return a ? cloneA(a) : null;
    },
    daTurma: async (t: string) =>
      [...atividades.values()]
        .filter((a) => a.turmaId === t)
        .sort((a, b) => a.prazo.localeCompare(b.prazo))
        .map(cloneA),
    doProfessor: async (p: string) =>
      [...atividades.values()].filter((a) => a.professorId === p).map(cloneA),
    lerNaTransacao: async (_tx: unknown, id: string) => {
      const a = atividades.get(id);
      return a ? cloneA(a) : null;
    },
    gravarNaTransacao: (tx: Array<() => void>, a: AtividadeEntity) => {
      const c = cloneA(a);
      tx.push(() => atividades.set(c.id, c));
    },
    excluirNaTransacao: (tx: Array<() => void>, id: string) => {
      tx.push(() => atividades.delete(id));
    },
  } as unknown as AtividadeRepository;

  const entregaRepo = {
    novoArquivoId: () => `f${++seq}`,
    findById: async (id: string) => {
      const e = entregas.get(id);
      return e ? cloneE(e) : null;
    },
    lerNaTransacao: async (_tx: unknown, id: string) => {
      const e = entregas.get(id);
      return e ? cloneE(e) : null;
    },
    gravarNaTransacao: (tx: Array<() => void>, e: EntregaEntity) => {
      const c = cloneE(e);
      tx.push(() => entregas.set(c.id, c));
    },
    daAtividade: async (atividadeId: string) =>
      [...entregas.values()]
        .filter((e) => e.atividadeId === atividadeId)
        .map(cloneE),
    doAluno: async (alunoId: string, turmaId: string) =>
      [...entregas.values()]
        .filter((e) => e.alunoId === alunoId && e.turmaId === turmaId)
        .map(cloneE),
  } as unknown as EntregaRepository;

  const turmas: Record<string, Record<string, unknown>> = {
    [TURMA]: {
      id: TURMA,
      professorId: PROF,
      configPontuacao: { pontuacaoAtiva: opcoes.pontuacaoAtiva ?? true },
    },
    outra: {
      id: 'outra',
      professorId: 'prof-2',
      configPontuacao: { pontuacaoAtiva: true },
    },
  };
  const turmaRepo = {
    findById: async (id: string) => (turmas[id] ? { ...turmas[id] } : null),
  } as unknown as TurmaRepository;

  const alunoRepo = {
    findById: async (id: string) => alunos[id] ?? null,
    findByTurma: async (t: string) =>
      Object.values(alunos).filter((a) => a.turmaId === t),
  } as unknown as AlunoRepository;

  const professorService = {
    getProfile: async () => ({ podeGamificar: opcoes.podeGamificar ?? true }),
  } as unknown as ProfessorService;

  /** Mesmo contrato do `XpService.ajustarNoMesmoCommit`: nunca fica negativo. */
  const xpService = {
    ajustarNoMesmoCommit: async <C>(op: {
      turmaId: string;
      alunoId: string;
      motivo: string;
      ler: (tx: unknown) => Promise<{ pontos: number; contexto: C }>;
      gravar: (tx: unknown, aplicado: number, contexto: C) => void;
    }) =>
      transacao(async (tx) => {
        const { pontos, contexto } = await op.ler(tx);
        const atual = xp[op.alunoId] ?? 0;
        const aplicado = pontos >= 0 ? pontos : -Math.min(-pontos, atual);
        if (aplicado !== 0) {
          (tx as Array<() => void>).push(() => {
            xp[op.alunoId] = atual + aplicado;
            xpLogs.push({
              alunoId: op.alunoId,
              pontos: aplicado,
              motivo: op.motivo,
            });
          });
        }
        op.gravar(tx, aplicado, contexto);
        return { aplicado, contexto };
      }),
  } as unknown as XpService;

  const arquivos = new Map<string, { tamanho: number; contentType: string }>();
  const apagados: string[] = [];
  const urls: Array<{ path: string; nome: string; contentType: string }> = [];
  const storage = {
    salvar: async (path: string, buffer: Buffer, contentType: string) => {
      if (ctl.falharUpload) throw new Error('storage fora do ar');
      arquivos.set(path, { tamanho: buffer.length, contentType });
    },
    apagar: async (path: string) => {
      apagados.push(path);
      arquivos.delete(path);
    },
    urlAssinada: async (path: string, nome: string, contentType: string) => {
      urls.push({ path, nome, contentType });
      return `https://assinada/${path}`;
    },
  } as unknown as AnexoStorage;

  const service = new TrabalhoService(
    atividadeRepo,
    entregaRepo,
    turmaRepo,
    alunoRepo,
    professorService,
    xpService,
    storage,
  );
  return {
    service,
    atividades,
    entregas,
    xp,
    xpLogs,
    ctl,
    arquivos,
    apagados,
    urls,
  };
}

async function comAtividade(
  m: ReturnType<typeof montar>,
  over: Record<string, unknown> = {},
) {
  return m.service.criarAtividade(PROF, TURMA, {
    titulo: 'Site pessoal',
    prazo: FUTURO,
    ...over,
  });
}

/** Simula o prazo vencendo depois que a atividade foi criada. */
function vencer(m: ReturnType<typeof montar>, id: string) {
  m.atividades.get(id)!.prazo = PASSADO;
}

describe('TrabalhoService — atividades do professor (#1–#5)', () => {
  it('cria e lista com contadores e total de alunos da turma', async () => {
    const m = montar();
    const a = await comAtividade(m, { valorPontos: 50 });
    expect(a).toMatchObject({
      titulo: 'Site pessoal',
      prazo: FUTURO,
      valorPontos: 50,
      aberta: true,
      totalEntregas: 0,
      aguardandoAvaliacao: 0,
    });
    const lista = await m.service.listarAtividades(PROF, TURMA);
    expect(lista).toHaveLength(1);
    expect(lista[0].totalAlunos).toBe(2);
  });

  it('prazo sem hora é recusado', async () => {
    const m = montar();
    expect(await falha(comAtividade(m, { prazo: '2099-12-05' }))).toBe(
      'PRAZO_INVALIDO',
    );
  });

  it('edita sem perder os contadores', async () => {
    const m = montar();
    const a = await comAtividade(m);
    m.atividades.get(a.id)!.totalEntregas = 3;
    const e = await m.service.editarAtividade(PROF, TURMA, a.id, {
      titulo: 'Novo',
      prazo: PASSADO,
    });
    expect(e.titulo).toBe('Novo');
    expect(e.aberta).toBe(false);
    expect(m.atividades.get(a.id)!.totalEntregas).toBe(3);
  });

  it('exclui só sem entregas', async () => {
    const m = montar();
    const a = await comAtividade(m);
    m.atividades.get(a.id)!.totalEntregas = 1;
    expect(await falha(m.service.excluirAtividade(PROF, TURMA, a.id))).toBe(
      'ATIVIDADE_COM_ENTREGAS',
    );
    m.atividades.get(a.id)!.totalEntregas = 0;
    await m.service.excluirAtividade(PROF, TURMA, a.id);
    expect(m.atividades.has(a.id)).toBe(false);
  });

  it('turma de outro professor ou atividade de outra turma: 404', async () => {
    const m = montar();
    await expect(m.service.listarAtividades(PROF, 'outra')).rejects.toThrow(
      NotFoundException,
    );
    const a = await comAtividade(m);
    m.atividades.get(a.id)!.turmaId = 'outra';
    await expect(
      m.service.editarAtividade(PROF, TURMA, a.id, { titulo: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('fora do PhD: 403', async () => {
    const m = montar({ podeGamificar: false });
    await expect(m.service.listarAtividades(PROF, TURMA)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('pendentes somam "para avaliar" por turma', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const b = await comAtividade(m);
    m.atividades.get(a.id)!.aguardandoAvaliacao = 2;
    m.atividades.get(b.id)!.aguardandoAvaliacao = 1;
    expect(await m.service.pendentesPorTurma(PROF)).toEqual({ [TURMA]: 3 });
  });
});
