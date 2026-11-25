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

const ANA = { alunoId: 'a1', turmaId: TURMA };
const BRUNO = { alunoId: 'a2', turmaId: TURMA };

describe('TrabalhoService — entrega do aluno (#6–#13)', () => {
  it('lista as atividades da turma com o estado da minha entrega', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const b = await comAtividade(m, { titulo: 'Vencida' });
    vencer(m, b.id);
    await m.service.salvarTexto(ANA, a.id, 'Meu trabalho');
    const lista = await m.service.listarDoAluno(ANA);
    expect(lista.map((x) => [x.atividade.titulo, x.estado])).toEqual([
      ['Site pessoal', 'ENTREGUE'],
      ['Vencida', 'PERDIDA'],
    ]);
    const doBruno = await m.service.listarDoAluno(BRUNO);
    expect(doBruno[0].estado).toBe('PENDENTE');
    // a visão do aluno não traz os contadores da turma
    expect(lista[0].atividade).not.toHaveProperty('totalEntregas');
  });

  it('salvar texto cria a entrega (id determinístico) e conta 1 vez', async () => {
    const m = montar();
    const a = await comAtividade(m);
    await m.service.salvarTexto(ANA, a.id, 'v1');
    const r = await m.service.salvarTexto(ANA, a.id, 'v2');
    expect(r.texto).toBe('v2');
    expect(r.estado).toBe('ENTREGUE');
    expect([...m.entregas.keys()]).toEqual([`${a.id}_a1`]);
    expect(m.atividades.get(a.id)).toMatchObject({
      totalEntregas: 1,
      aguardandoAvaliacao: 1,
    });
  });

  it('apagar o texto de uma entrega sem arquivos tira do contador', async () => {
    const m = montar();
    const a = await comAtividade(m);
    await m.service.salvarTexto(ANA, a.id, 'v1');
    const r = await m.service.salvarTexto(ANA, a.id, '');
    expect(r.estado).toBe('PENDENTE');
    expect(m.atividades.get(a.id)!.totalEntregas).toBe(0);
  });

  it('texto acima de 10.000: 400 TEXTO_GRANDE', async () => {
    const m = montar();
    const a = await comAtividade(m);
    expect(
      await falha(m.service.salvarTexto(ANA, a.id, 'x'.repeat(10001))),
    ).toBe('TEXTO_GRANDE');
  });

  it('fora do prazo: 403 PRAZO_ENCERRADO (texto e arquivo)', async () => {
    const m = montar();
    const a = await comAtividade(m);
    vencer(m, a.id);
    expect(await falha(m.service.salvarTexto(ANA, a.id, 'tarde'))).toBe(
      'PRAZO_ENCERRADO',
    );
    expect(
      await falha(
        m.service.enviarArquivo(ANA, a.id, {
          originalname: 'a.pdf',
          buffer: PDF,
        }),
      ),
    ).toBe('PRAZO_ENCERRADO');
    expect(m.arquivos.size).toBe(0);
  });

  it('envia arquivo: sobe privado e entra na entrega sem o path', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const r = await m.service.enviarArquivo(ANA, a.id, {
      originalname: 'relatório.pdf',
      buffer: PDF,
    });
    expect(r.arquivos).toHaveLength(1);
    expect(r.arquivos[0]).toMatchObject({
      nome: 'relatório.pdf',
      extensao: 'pdf',
      tamanho: PDF.length,
    });
    expect(r.arquivos[0]).not.toHaveProperty('path');
    const path = `trabalhos/${TURMA}/${a.id}/a1/${r.arquivos[0].id}`;
    expect(m.arquivos.get(path)?.contentType).toBe('application/pdf');
    expect(m.atividades.get(a.id)!.totalEntregas).toBe(1);
  });

  it('imagem é recusada antes de subir', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(
      await falha(
        m.service.enviarArquivo(ANA, a.id, {
          originalname: 'foto.pdf',
          buffer: png,
        }),
      ),
    ).toBe('TIPO_ARQUIVO_NAO_ACEITO');
    expect(m.arquivos.size).toBe(0);
  });

  it('6º arquivo: 409 LIMITE_ARQUIVOS, sem subir nada', async () => {
    const m = montar();
    const a = await comAtividade(m);
    for (let i = 0; i < 5; i++) {
      await m.service.enviarArquivo(ANA, a.id, {
        originalname: `p${i}.pdf`,
        buffer: PDF,
      });
    }
    expect(
      await falha(
        m.service.enviarArquivo(ANA, a.id, {
          originalname: 'p5.pdf',
          buffer: PDF,
        }),
      ),
    ).toBe('LIMITE_ARQUIVOS');
    expect(m.arquivos.size).toBe(5);
  });

  it('transação recusada apaga o arquivo que subiu', async () => {
    const m = montar();
    const a = await comAtividade(m);
    m.ctl.falharTx = true;
    await expect(
      m.service.enviarArquivo(ANA, a.id, {
        originalname: 'a.pdf',
        buffer: PDF,
      }),
    ).rejects.toThrow();
    expect(m.arquivos.size).toBe(0);
    expect(m.apagados).toHaveLength(1);
    expect(m.entregas.size).toBe(0);
  });

  it('falha no upload: 502 ANEXO_FALHOU, nada gravado', async () => {
    const m = montar();
    const a = await comAtividade(m);
    m.ctl.falharUpload = true;
    expect(
      await falha(
        m.service.enviarArquivo(ANA, a.id, {
          originalname: 'a.pdf',
          buffer: PDF,
        }),
      ),
    ).toBe('ANEXO_FALHOU');
    expect(m.entregas.size).toBe(0);
  });

  it('remove arquivo: sai da entrega e do Storage', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const r = await m.service.enviarArquivo(ANA, a.id, {
      originalname: 'a.pdf',
      buffer: PDF,
    });
    const depois = await m.service.removerArquivo(ANA, a.id, r.arquivos[0].id);
    expect(depois.arquivos).toHaveLength(0);
    expect(depois.estado).toBe('PENDENTE');
    expect(m.arquivos.size).toBe(0);
    expect(m.atividades.get(a.id)!.totalEntregas).toBe(0);
  });

  it('download pela URL assinada; HTML sai como text/plain', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const r = await m.service.enviarArquivo(ANA, a.id, {
      originalname: 'index.html',
      buffer: Buffer.from('<script>alert(1)</script>'),
    });
    const { url } = await m.service.arquivoDoAluno(ANA, a.id, r.arquivos[0].id);
    expect(url).toContain('https://assinada/');
    expect(m.urls[0]).toMatchObject({
      nome: 'index.html',
      contentType: 'text/plain; charset=utf-8',
    });
  });

  it('isolamento: atividade de outra turma e arquivo de outro aluno são 404', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const fora = { alunoId: 'x9', turmaId: 'outra' };
    await expect(m.service.detalheDoAluno(fora, a.id)).rejects.toThrow(
      NotFoundException,
    );
    const r = await m.service.enviarArquivo(ANA, a.id, {
      originalname: 'a.pdf',
      buffer: PDF,
    });
    await expect(
      m.service.arquivoDoAluno(BRUNO, a.id, r.arquivos[0].id),
    ).rejects.toThrow(NotFoundException);
    expect((await m.service.detalheDoAluno(BRUNO, a.id)).entrega).toBeNull();
  });

  it('turma de professor fora do PhD: 403', async () => {
    const m = montar({ podeGamificar: false });
    await expect(m.service.listarDoAluno(ANA)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('TrabalhoService — entregas e avaliação do professor (#14–#19)', () => {
  async function comEntrega(m: ReturnType<typeof montar>, valorPontos = 100) {
    const a = await comAtividade(m, { valorPontos });
    await m.service.salvarTexto(ANA, a.id, 'Meu trabalho');
    return a;
  }

  it('lista todos os alunos com o estado, para avaliar primeiro', async () => {
    const m = montar();
    const a = await comEntrega(m);
    const r = await m.service.entregasDaAtividade(PROF, TURMA, a.id);
    expect(r.atividade.totalEntregas).toBe(1);
    expect(r.alunos.map((x) => [x.alunoNome, x.estado])).toEqual([
      ['Ana', 'ENTREGUE'],
      ['Bruno', 'PENDENTE'],
    ]);
    expect(r.alunos[0]).toMatchObject({ temTexto: true, totalArquivos: 0 });
  });

  it('abre a entrega completa; aluno sem entrega vem com entrega null', async () => {
    const m = montar();
    const a = await comEntrega(m);
    const ana = await m.service.entregaDoAluno(PROF, TURMA, a.id, 'a1');
    expect(ana.aluno).toEqual({ id: 'a1', nome: 'Ana' });
    expect(ana.entrega?.texto).toBe('Meu trabalho');
    const bruno = await m.service.entregaDoAluno(PROF, TURMA, a.id, 'a2');
    expect(bruno.entrega).toBeNull();
    expect(bruno.estado).toBe('PENDENTE');
  });

  it('aluno de outra turma: 404', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await expect(
      m.service.entregaDoAluno(PROF, TURMA, a.id, 'x9'),
    ).rejects.toThrow(NotFoundException);
  });

  it('baixa o arquivo do aluno pela URL assinada', async () => {
    const m = montar();
    const a = await comAtividade(m);
    const r = await m.service.enviarArquivo(ANA, a.id, {
      originalname: 'estilo.css',
      buffer: Buffer.from('body { color: red }'),
    });
    await m.service.arquivoDoProfessor(
      PROF,
      TURMA,
      a.id,
      'a1',
      r.arquivos[0].id,
    );
    expect(m.urls[0]).toMatchObject({
      path: `trabalhos/${TURMA}/${a.id}/a1/${r.arquivos[0].id}`,
      contentType: 'text/plain; charset=utf-8',
    });
  });

  it('avaliar: nota 8 de 100 → +80 XP com log TRABALHO, sai do "para avaliar"', async () => {
    const m = montar();
    const a = await comEntrega(m);
    const r = await m.service.avaliar(PROF, TURMA, a.id, 'a1', {
      nota: 8,
      comentario: 'Muito bom',
    });
    expect(r.estado).toBe('AVALIADA');
    expect(r.avaliacao).toMatchObject({
      nota: 8,
      comentario: 'Muito bom',
      pontos: 80,
    });
    expect(m.xp.a1).toBe(80);
    expect(m.xpLogs).toEqual([
      { alunoId: 'a1', pontos: 80, motivo: 'TRABALHO' },
    ]);
    expect(m.atividades.get(a.id)).toMatchObject({
      totalEntregas: 1,
      aguardandoAvaliacao: 0,
    });
    expect(await m.service.pendentesPorTurma(PROF)).toEqual({});
  });

  it('avaliada, o aluno não edita mais (409 ENTREGA_AVALIADA)', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 5 });
    expect(await falha(m.service.salvarTexto(ANA, a.id, 'mudei'))).toBe(
      'ENTREGA_AVALIADA',
    );
  });

  it('reavaliar credita só a diferença e não volta para "para avaliar"', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 8 });
    const r = await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 9.5 });
    expect(r.avaliacao?.pontos).toBe(95);
    expect(m.xp.a1).toBe(95);
    expect(m.xpLogs.map((l) => l.pontos)).toEqual([80, 15]);
    expect(m.atividades.get(a.id)!.aguardandoAvaliacao).toBe(0);
  });

  it('reavaliar para baixo nunca deixa o XP negativo', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 10 });
    m.xp.a1 = 30; // gastou/perdeu pontos em outro lugar
    const r = await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 0 });
    expect(m.xp.a1).toBe(0);
    expect(r.avaliacao?.pontos).toBe(70);
  });

  it('pontuação desativada na turma: nota sem XP', async () => {
    const m = montar({ pontuacaoAtiva: false });
    const a = await comEntrega(m);
    const r = await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 10 });
    expect(r.avaliacao).toMatchObject({ nota: 10, pontos: 0 });
    expect(m.xp.a1).toBe(0);
    expect(m.xpLogs).toHaveLength(0);
  });

  it('só avalia quem entregou; nota inválida é 400', async () => {
    const m = montar();
    const a = await comEntrega(m);
    expect(
      await falha(m.service.avaliar(PROF, TURMA, a.id, 'a2', { nota: 5 })),
    ).toBe('ENTREGA_NAO_ENCONTRADA');
    expect(
      await falha(m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 11 })),
    ).toBe('NOTA_INVALIDA');
    expect(m.xpLogs).toHaveLength(0);
  });

  it('avalia mesmo depois do prazo', async () => {
    const m = montar();
    const a = await comEntrega(m);
    vencer(m, a.id);
    const r = await m.service.avaliar(PROF, TURMA, a.id, 'a1', { nota: 7 });
    expect(r.avaliacao?.pontos).toBe(70);
  });

  it('o aluno vê a nota, o comentário e os pontos', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await m.service.avaliar(PROF, TURMA, a.id, 'a1', {
      nota: 6.5,
      comentario: 'Faltou o CSS',
    });
    const d = await m.service.detalheDoAluno(ANA, a.id);
    expect(d.estado).toBe('AVALIADA');
    expect(d.entrega?.avaliacao).toMatchObject({
      nota: 6.5,
      comentario: 'Faltou o CSS',
      pontos: 65,
    });
    const lista = await m.service.listarDoAluno(ANA);
    expect(lista[0]).toMatchObject({ estado: 'AVALIADA', nota: 6.5 });
  });

  it('professor de outra turma: 404', async () => {
    const m = montar();
    const a = await comEntrega(m);
    await expect(
      m.service.entregasDaAtividade('prof-2', TURMA, a.id),
    ).rejects.toThrow(NotFoundException);
  });
});
