import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AlunoEntity } from '../turma/entities/aluno.entity';
import { DenunciaEntity } from './entities/denuncia.entity';
import { DenunciaTopicoEntity } from './entities/denuncia-topico.entity';
import { DenunciaService } from './denuncia.service';
import { DenunciaRepository } from './denuncia.repository';
import { DenunciaTopicoRepository } from './denuncia-topico.repository';
import { DenunciaImagemStorage } from './denuncia-imagem.storage';
import { DenunciaJanelaRepository } from './denuncia-janela.repository';
import { DenunciaJanelaEntity } from './entities/denuncia-janela.entity';
import { DenunciaGrupoRepository } from './denuncia-grupo.repository';
import { DenunciaGrupoEntity } from './entities/denuncia-grupo.entity';
import { dividirIgual } from '../common/dividir';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { XpService } from '../turma/xp.service';
import { ProfessorService } from '../professor/professor.service';

/**
 * Spec 032 — denúncia entre alunos. O que importa travar:
 * - a transferência de XP é real: nunca sai mais do que o denunciado tem (#2);
 * - o aluno nunca recebe o autor de uma denúncia (#3);
 * - as travas de abuso (#4) e o teto de 10.000 (#6);
 * - a imagem some quando a denúncia é resolvida (#5).
 *
 * Spec 033: o aluno não envia mais foto (400 IMAGEM_REMOVIDA). As denúncias
 * antigas que já têm foto (legado) seguem visíveis até serem resolvidas.
 */

const PROF = 'prof-1';
const TURMA = 't1';

function montar(
  opcoes: {
    pontuacaoAtiva?: boolean;
    podeGamificar?: boolean;
    /** Fixture: a maioria dos testes parte com a janela aberta (033). */
    denunciasAbertas?: boolean;
  } = {},
) {
  const alunos: Record<string, AlunoEntity> = {
    a1: new AlunoEntity({
      id: 'a1',
      turmaId: TURMA,
      nome: 'Ana',
      xpTotal: 5000,
    }),
    a2: new AlunoEntity({
      id: 'a2',
      turmaId: TURMA,
      nome: 'Bruno',
      xpTotal: 500,
    }),
    a3: new AlunoEntity({ id: 'a3', turmaId: TURMA, nome: 'Caio', xpTotal: 0 }),
    x9: new AlunoEntity({
      id: 'x9',
      turmaId: 'outra',
      nome: 'Fora',
      xpTotal: 0,
    }),
  };
  const denuncias = new Map<string, DenunciaEntity>();
  const topicos = new Map<string, DenunciaTopicoEntity>();
  let seq = 0;

  const denunciaRepo = {
    create: async (d: Omit<DenunciaEntity, 'id'>) => {
      const e = new DenunciaEntity({ ...d, id: `d${++seq}` });
      denuncias.set(e.id, e);
      return e;
    },
    findById: async (id: string) => denuncias.get(id) ?? null,
    findBy: async (campo: keyof DenunciaEntity, valor: unknown) =>
      [...denuncias.values()].filter((d) => d[campo] === valor),
    update: async (id: string, patch: Partial<DenunciaEntity>) => {
      Object.assign(denuncias.get(id)!, patch);
    },
    resolverSePendente: async (id: string, patch: Partial<DenunciaEntity>) => {
      const d = denuncias.get(id)!;
      d.assertPendente();
      Object.assign(d, patch);
    },
    ref: (id: string) => id,
    pendentesDoProfessor: async (professorId: string) =>
      [...denuncias.values()].filter(
        (d) => d.professorId === professorId && d.pendente,
      ),
  } as unknown as DenunciaRepository;

  const topicoRepo = {
    create: async (t: Omit<DenunciaTopicoEntity, 'id'>) => {
      const e = new DenunciaTopicoEntity({ ...t, id: `tp${++seq}` });
      topicos.set(e.id, e);
      return e;
    },
    findById: async (id: string) => topicos.get(id) ?? null,
    findBy: async (campo: keyof DenunciaTopicoEntity, valor: unknown) =>
      [...topicos.values()].filter((t) => t[campo] === valor),
    update: async (id: string, patch: Partial<DenunciaTopicoEntity>) => {
      Object.assign(topicos.get(id)!, patch);
    },
  } as unknown as DenunciaTopicoRepository;

  const turmas: Record<string, Record<string, unknown>> = {
    [TURMA]: {
      id: TURMA,
      professorId: PROF,
      configPontuacao: { pontuacaoAtiva: opcoes.pontuacaoAtiva ?? true },
      denunciasAbertas: opcoes.denunciasAbertas ?? true,
      denunciaJanelaId: (opcoes.denunciasAbertas ?? true) ? 'j0' : undefined,
    },
    outra: {
      id: 'outra',
      professorId: 'prof-2',
      configPontuacao: { pontuacaoAtiva: true },
    },
  };
  const turmaRepo = {
    findById: async (id: string) => (turmas[id] ? { ...turmas[id] } : null),
    update: async (id: string, patch: Record<string, unknown>) => {
      Object.assign(turmas[id], patch);
    },
  } as unknown as TurmaRepository;

  const janelas = new Map<string, DenunciaJanelaEntity>();
  if (opcoes.denunciasAbertas ?? true) {
    janelas.set(
      'j0',
      new DenunciaJanelaEntity({
        id: 'j0',
        turmaId: TURMA,
        professorId: PROF,
        abertaEm: '2026-11-12T10:00:00.000Z',
      }),
    );
  }
  const janelaRepo = {
    create: async (j: Omit<DenunciaJanelaEntity, 'id'>) => {
      const e = new DenunciaJanelaEntity({ ...j, id: `j${++seq}` });
      janelas.set(e.id, e);
      return e;
    },
    findById: async (id: string) => janelas.get(id) ?? null,
    findBy: async (campo: keyof DenunciaJanelaEntity, valor: unknown) =>
      [...janelas.values()].filter((j) => j[campo] === valor),
    update: async (id: string, patch: Partial<DenunciaJanelaEntity>) => {
      Object.assign(janelas.get(id)!, patch);
    },
  } as unknown as DenunciaJanelaRepository;

  const alunoRepo = {
    findById: async (id: string) => alunos[id] ?? null,
    findByTurma: async (t: string) =>
      Object.values(alunos).filter((a) => a.turmaId === t),
  } as unknown as AlunoRepository;

  const xpLogs: Array<{ alunoId: string; pontos: number; motivo: string }> = [];
  const xp = {
    transferir: async (op: {
      deAlunoId: string;
      paraAlunoId: string;
      pontos: number;
      motivo: string;
      noMesmoCommit?: {
        ler: (tx: unknown) => Promise<void>;
        gravar: (tx: unknown, t: number) => void;
      };
    }) => {
      await op.noMesmoCommit?.ler(null);
      const de = alunos[op.deAlunoId];
      const t = DenunciaEntity.aTransferir(op.pontos, de.xpTotal);
      de.xpTotal -= t;
      alunos[op.paraAlunoId].xpTotal += t;
      if (t > 0) {
        xpLogs.push({ alunoId: op.deAlunoId, pontos: -t, motivo: op.motivo });
        xpLogs.push({ alunoId: op.paraAlunoId, pontos: t, motivo: op.motivo });
      }
      op.noMesmoCommit?.gravar(null, t);
      return t;
    },
    transferirParaVarios: async (op: {
      deAlunoId: string;
      paraAlunoIds: string[];
      pontos: number;
      motivo: string;
      noMesmoCommit?: {
        ler: (tx: unknown) => Promise<void>;
        gravar: (
          tx: unknown,
          t: number,
          partes: Array<{ alunoId: string; pontos: number }>,
        ) => void;
      };
    }) => {
      await op.noMesmoCommit?.ler(null);
      const de = alunos[op.deAlunoId];
      const t = DenunciaEntity.aTransferir(op.pontos, de.xpTotal);
      const valores = dividirIgual(t, op.paraAlunoIds.length);
      const partes = op.paraAlunoIds.map((alunoId, i) => ({
        alunoId,
        pontos: valores[i],
      }));
      de.xpTotal -= t;
      if (t > 0) {
        xpLogs.push({ alunoId: op.deAlunoId, pontos: -t, motivo: op.motivo });
      }
      for (const p of partes) {
        alunos[p.alunoId].xpTotal += p.pontos;
        if (p.pontos > 0) {
          xpLogs.push({
            alunoId: p.alunoId,
            pontos: p.pontos,
            motivo: op.motivo,
          });
        }
      }
      op.noMesmoCommit?.gravar(null, t, partes);
      return { transferido: t, partes };
    },
  } as unknown as XpService;

  const professorService = {
    getProfile: async () => ({ podeGamificar: opcoes.podeGamificar ?? true }),
  } as unknown as ProfessorService;

  const imagens = {
    salvas: new Set<string>(),
    salvar: async (path: string) => {
      imagens.salvas.add(path);
    },
    apagar: async (path: string) => {
      imagens.salvas.delete(path);
    },
    urlAssinada: async (path: string) => `https://assinada/${path}`,
  };

  // O repo simulado precisa ler/gravar dentro do "commit" do XP.
  (denunciaRepo as unknown as { lerNaTransacao: unknown }).lerNaTransacao =
    async (_tx: unknown, id: string) =>
      denuncias.get(id) ?? new DenunciaEntity({ id });
  (
    denunciaRepo as unknown as { gravarNaTransacao: unknown }
  ).gravarNaTransacao = (
    _tx: unknown,
    id: string,
    patch: Partial<DenunciaEntity>,
  ) => Object.assign(denuncias.get(id)!, patch);

  const grupos = new Map<string, DenunciaGrupoEntity>();
  const grupoRepo = {
    transacao: async <T>(fn: (tx: unknown) => Promise<T>) => fn(null),
    novoId: () => `g${++seq}`,
    findById: async (id: string) => grupos.get(id) ?? null,
    findBy: async (campo: keyof DenunciaGrupoEntity, valor: unknown) =>
      [...grupos.values()].filter((g) => g[campo] === valor),
    lerNaTransacao: async (_tx: unknown, id: string) =>
      grupos.get(id) ? new DenunciaGrupoEntity({ ...grupos.get(id)! }) : null,
    gravarNaTransacao: (_tx: unknown, g: DenunciaGrupoEntity) => {
      grupos.set(g.id, new DenunciaGrupoEntity({ ...g }));
    },
    apagarNaTransacao: (_tx: unknown, id: string) => {
      grupos.delete(id);
    },
  } as unknown as DenunciaGrupoRepository;

  const service = new DenunciaService(
    denunciaRepo,
    topicoRepo,
    turmaRepo,
    alunoRepo,
    xp,
    professorService,
    imagens as unknown as DenunciaImagemStorage,
    janelaRepo,
    grupoRepo,
  );
  return {
    service,
    alunos,
    denuncias,
    topicos,
    xpLogs,
    imagens,
    turmas,
    janelas,
    grupos,
  };
}

const aluno = (alunoId: string) => ({ alunoId, turmaId: TURMA });
const jpeg = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1000 };

describe('DenunciaService — tópicos', () => {
  it('cria, lista só os ativos do professor e arquiva', async () => {
    const { service } = montar();
    const t = await service.criarTopico(PROF, {
      titulo: '  Celular em sala ',
      pontosSugeridos: 2000,
    });
    expect(t.titulo).toBe('Celular em sala');
    await service.criarTopico('prof-2', {
      titulo: 'De outro',
      pontosSugeridos: 1,
    });
    expect((await service.listarTopicos(PROF)).map((x) => x.titulo)).toEqual([
      'Celular em sala',
    ]);
    await service.editarTopico(PROF, t.id, { ativo: false });
    expect(await service.listarTopicos(PROF)).toEqual([]);
  });

  it('recusa pontuação sugerida acima do teto e tópico de outro professor', async () => {
    const { service } = montar();
    await expect(
      service.criarTopico(PROF, { titulo: 'Abc', pontosSugeridos: 10001 }),
    ).rejects.toThrow(BadRequestException);
    const t = await service.criarTopico('prof-2', {
      titulo: 'Abc',
      pontosSugeridos: 1,
    });
    await expect(
      service.editarTopico(PROF, t.id, { titulo: 'Xyz' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('sem gamificação no plano, 403', async () => {
    const { service } = montar({ podeGamificar: false });
    await expect(service.listarTopicos(PROF)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('DenunciaService — aluno denuncia', () => {
  it('opções: colegas sem o próprio e tópicos ativos do professor da turma', async () => {
    const { service } = montar();
    await service.criarTopico(PROF, {
      titulo: 'Celular',
      pontosSugeridos: 100,
    });
    const op = await service.opcoesAluno(aluno('a1'));
    expect(op.colegas.map((c) => c.nome)).toEqual(['Bruno', 'Caio']);
    expect(op.topicos.map((t) => t.titulo)).toEqual(['Celular']);
    expect(op.topicos[0]).not.toHaveProperty('pontosSugeridos');
  });

  it('cria com tópico e texto, sem foto', async () => {
    const { service, denuncias } = montar();
    const tp = await service.criarTopico(PROF, {
      titulo: 'Celular',
      pontosSugeridos: 100,
    });
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      topicoId: tp.id,
      texto: ' no recreio ',
    });
    const d = [...denuncias.values()][0];
    expect(d).toMatchObject({
      autorAlunoId: 'a1',
      denunciadoAlunoId: 'a2',
      topicoTitulo: 'Celular',
      texto: 'no recreio',
      status: 'PENDENTE',
      professorId: PROF,
    });
    expect(d.imagemPath).toBeUndefined();
  });

  it('com arquivo de imagem: 400 IMAGEM_REMOVIDA e nada é criado (033)', async () => {
    const { service, denuncias, imagens } = montar();
    const erro: unknown = await service
      .criarDoAluno(aluno('a1'), { denunciadoAlunoId: 'a2', texto: 'x' }, jpeg)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).getResponse()).toMatchObject({
      code: 'IMAGEM_REMOVIDA',
    });
    expect(denuncias.size).toBe(0);
    expect(imagens.salvas.size).toBe(0);
  });

  it('exige tópico ou texto', async () => {
    const { service } = montar();
    await expect(
      service.criarDoAluno(aluno('a1'), { denunciadoAlunoId: 'a2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa autodenúncia, colega de outra turma e tópico de outro professor', async () => {
    const { service } = montar();
    await expect(
      service.criarDoAluno(aluno('a1'), {
        denunciadoAlunoId: 'a1',
        texto: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.criarDoAluno(aluno('a1'), {
        denunciadoAlunoId: 'x9',
        texto: 'x',
      }),
    ).rejects.toThrow(NotFoundException);
    const alheio = await service.criarTopico('prof-2', {
      titulo: 'Outro',
      pontosSugeridos: 1,
    });
    await expect(
      service.criarDoAluno(aluno('a1'), {
        denunciadoAlunoId: 'a2',
        topicoId: alheio.id,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('recusa duplicada pendente e a 4ª pendente', async () => {
    const { service, alunos } = montar();
    alunos.a4 = new AlunoEntity({ id: 'a4', turmaId: TURMA, nome: 'Duda' });
    alunos.a5 = new AlunoEntity({ id: 'a5', turmaId: TURMA, nome: 'Edu' });
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'x',
    });
    await expect(
      service.criarDoAluno(aluno('a1'), {
        denunciadoAlunoId: 'a2',
        texto: 'y',
      }),
    ).rejects.toThrow(/pendente contra esse colega/);
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a3',
      texto: 'x',
    });
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a4',
      texto: 'x',
    });
    await expect(
      service.criarDoAluno(aluno('a1'), {
        denunciadoAlunoId: 'a5',
        texto: 'x',
      }),
    ).rejects.toThrow(/aguardando/);
  });

  it('minhas denúncias: só as do autor, com o nome do denunciado e sem pontos', async () => {
    const { service } = montar();
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'x',
    });
    await service.criarDoAluno(aluno('a2'), {
      denunciadoAlunoId: 'a1',
      texto: 'vinganca',
    });
    const minhas = await service.minhasDoAluno(aluno('a1'));
    expect(minhas).toHaveLength(1);
    expect(minhas[0]).toMatchObject({
      denunciadoNome: 'Bruno',
      status: 'PENDENTE',
    });
    expect(minhas[0]).not.toHaveProperty('autorAlunoId');
    expect(minhas[0]).not.toHaveProperty('pontosTransferidos');
  });
});

describe('DenunciaService — professor resolve', () => {
  async function comDenuncia(opcoes?: { pontuacaoAtiva?: boolean }) {
    const ctx = montar(opcoes);
    await ctx.service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'celular',
    });
    const id = [...ctx.denuncias.keys()][0];
    // Foto de legado (antes da 033): continua até a denúncia ser resolvida.
    const path = `denuncias/${TURMA}/${id}.jpg`;
    ctx.denuncias.get(id)!.imagemPath = path;
    ctx.imagens.salvas.add(path);
    return { ...ctx, id };
  }

  it('lista da turma com autor, denunciado e XP atual do denunciado', async () => {
    const { service } = await comDenuncia();
    const lista = await service.listarDaTurma(PROF, TURMA);
    expect(lista[0]).toMatchObject({
      autorNome: 'Ana',
      denunciadoNome: 'Bruno',
      xpDenunciado: 500,
      temImagem: true,
      status: 'PENDENTE',
    });
    expect(lista[0]).not.toHaveProperty('imagemPath');
  });

  it('turma de outro professor é 404', async () => {
    const { service, id } = await comDenuncia();
    await expect(service.listarDaTurma('prof-2', TURMA)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.validar('prof-2', TURMA, id, 100)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('validar transfere o que o denunciado tem (500 de 2000) e grava os dois logs', async () => {
    const { service, alunos, denuncias, xpLogs, id } = await comDenuncia();
    await service.validar(PROF, TURMA, id, 2000);
    expect(alunos.a2.xpTotal).toBe(0);
    expect(alunos.a1.xpTotal).toBe(5500);
    expect(xpLogs).toEqual([
      { alunoId: 'a2', pontos: -500, motivo: 'DENUNCIA' },
      { alunoId: 'a1', pontos: 500, motivo: 'DENUNCIA' },
    ]);
    expect(denuncias.get(id)).toMatchObject({
      status: 'VALIDADA',
      pontos: 2000,
      pontosTransferidos: 500,
    });
  });

  it('validar apaga a imagem; invalidar também', async () => {
    const a = await comDenuncia();
    const path = a.denuncias.get(a.id)!.imagemPath!;
    await a.service.validar(PROF, TURMA, a.id, 10);
    expect(a.imagens.salvas.has(path)).toBe(false);
    expect(a.denuncias.get(a.id)!.imagemPath).toBeNull();

    const b = await comDenuncia();
    const pathB = b.denuncias.get(b.id)!.imagemPath!;
    await b.service.invalidar(PROF, TURMA, b.id);
    expect(b.imagens.salvas.has(pathB)).toBe(false);
    expect(b.denuncias.get(b.id)!.status).toBe('INVALIDADA');
    expect(b.alunos.a2.xpTotal).toBe(500);
  });

  it('resolver duas vezes é 409 e não transfere de novo', async () => {
    const { service, alunos, id } = await comDenuncia();
    await service.validar(PROF, TURMA, id, 100);
    await expect(service.validar(PROF, TURMA, id, 100)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.invalidar(PROF, TURMA, id)).rejects.toThrow(
      ConflictException,
    );
    expect(alunos.a2.xpTotal).toBe(400);
  });

  it('recusa pontos acima de 10.000', async () => {
    const { service, id } = await comDenuncia();
    await expect(service.validar(PROF, TURMA, id, 10001)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('turma sem pontuação: valida sem mexer no XP', async () => {
    const { service, alunos, denuncias, id } = await comDenuncia({
      pontuacaoAtiva: false,
    });
    await service.validar(PROF, TURMA, id, 300);
    expect(alunos.a2.xpTotal).toBe(500);
    expect(denuncias.get(id)).toMatchObject({
      status: 'VALIDADA',
      pontosTransferidos: 0,
    });
  });

  it('URL assinada da imagem só para o dono e só se houver imagem', async () => {
    const { service, id } = await comDenuncia();
    expect((await service.urlImagem(PROF, TURMA, id)).url).toMatch(
      /^https:\/\/assinada\//,
    );
    await expect(service.urlImagem('prof-2', TURMA, id)).rejects.toThrow(
      NotFoundException,
    );
    await service.invalidar(PROF, TURMA, id);
    await expect(service.urlImagem(PROF, TURMA, id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('pendentes por turma para o badge', async () => {
    const { service, id } = await comDenuncia();
    await service.criarDoAluno(aluno('a3'), {
      denunciadoAlunoId: 'a2',
      texto: 'y',
    });
    expect(await service.pendentesPorTurma(PROF)).toEqual({ [TURMA]: 2 });
    await service.invalidar(PROF, TURMA, id);
    expect(await service.pendentesPorTurma(PROF)).toEqual({ [TURMA]: 1 });
  });
});

describe('DenunciaService — janela de denúncia (033)', () => {
  it('turma sem o campo começa fechada: o aluno recebe 403 DENUNCIAS_FECHADAS', async () => {
    const { service, turmas } = montar();
    delete turmas[TURMA].denunciasAbertas;
    delete turmas[TURMA].denunciaJanelaId;
    expect((await service.opcoesAluno(aluno('a1'))).abertas).toBe(false);
    const erro: unknown = await service
      .criarDoAluno(aluno('a1'), { denunciadoAlunoId: 'a2', texto: 'x' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({
      code: 'DENUNCIAS_FECHADAS',
    });
  });

  it('abrir cria uma janela, a denúncia guarda o janelaId e fechar registra o fim', async () => {
    const { service, denuncias, janelas } = montar({ denunciasAbertas: false });
    const aberta = await service.abrirJanela(PROF, TURMA);
    expect(aberta.abertas).toBe(true);
    expect(janelas.size).toBe(1);
    const jid = [...janelas.keys()][0];
    expect(janelas.get(jid)).toMatchObject({
      turmaId: TURMA,
      professorId: PROF,
    });
    expect(janelas.get(jid)!.fechadaEm).toBeUndefined();

    expect((await service.opcoesAluno(aluno('a1'))).abertas).toBe(true);
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'x',
    });
    expect([...denuncias.values()][0].janelaId).toBe(jid);

    const fechada = await service.fecharJanela(PROF, TURMA);
    expect(fechada.abertas).toBe(false);
    expect(janelas.get(jid)!.fechadaEm).toEqual(expect.any(String));
    await expect(
      service.criarDoAluno(aluno('a3'), {
        denunciadoAlunoId: 'a2',
        texto: 'y',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('abrir já aberta e fechar já fechada não criam janela nova', async () => {
    const { service, janelas } = montar({ denunciasAbertas: false });
    await service.abrirJanela(PROF, TURMA);
    await service.abrirJanela(PROF, TURMA);
    expect(janelas.size).toBe(1);
    await service.fecharJanela(PROF, TURMA);
    const fim = [...janelas.values()][0].fechadaEm;
    await service.fecharJanela(PROF, TURMA);
    expect([...janelas.values()][0].fechadaEm).toBe(fim);
  });

  it('fechar não impede resolver as pendentes', async () => {
    const { service, denuncias } = montar();
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'x',
    });
    await service.fecharJanela(PROF, TURMA);
    const id = [...denuncias.keys()][0];
    await service.validar(PROF, TURMA, id, 100);
    expect(denuncias.get(id)!.status).toBe('VALIDADA');
  });

  it('histórico de janelas: mais nova primeiro, com o estado atual; só o dono', async () => {
    const { service } = montar({ denunciasAbertas: false });
    await service.abrirJanela(PROF, TURMA);
    await service.fecharJanela(PROF, TURMA);
    await service.abrirJanela(PROF, TURMA);
    const h = await service.janelas(PROF, TURMA);
    expect(h.abertas).toBe(true);
    expect(h.janelas).toHaveLength(2);
    expect(h.janelas[0].fechadaEm).toBeUndefined();
    expect(h.janelas[1].fechadaEm).toEqual(expect.any(String));
    expect(h.janelaAtualId).toBe(h.janelas[0].id);
    await expect(service.janelas('prof-2', TURMA)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.abrirJanela('prof-2', TURMA)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('a lista do professor traz o janelaId de cada denúncia', async () => {
    const { service } = montar();
    await service.criarDoAluno(aluno('a1'), {
      denunciadoAlunoId: 'a2',
      texto: 'x',
    });
    expect((await service.listarDaTurma(PROF, TURMA))[0].janelaId).toBe('j0');
  });
});

describe('DenunciaService — grupos (033)', () => {
  /** Ana (a1), Caio (a3) e Duda (a4) denunciam Bruno (a2). */
  async function tresContraBruno(opcoes?: { pontuacaoAtiva?: boolean }) {
    const ctx = montar(opcoes);
    ctx.alunos.a4 = new AlunoEntity({
      id: 'a4',
      turmaId: TURMA,
      nome: 'Duda',
      xpTotal: 0,
    });
    const celular = await ctx.service.criarTopico(PROF, {
      titulo: 'Celular',
      pontosSugeridos: 900,
    });
    const briga = await ctx.service.criarTopico(PROF, {
      titulo: 'Briga',
      pontosSugeridos: 300,
    });
    const ids: string[] = [];
    for (const [autor, topicoId] of [
      ['a1', celular.id],
      ['a3', celular.id],
      ['a4', briga.id],
    ]) {
      const { id } = await ctx.service.criarDoAluno(aluno(autor), {
        denunciadoAlunoId: 'a2',
        topicoId,
      });
      ids.push(id);
      await new Promise((ok) => setTimeout(ok, 2));
    }
    return { ...ctx, ids, celular, briga };
  }

  it('sugere as pendentes avulsas com o mesmo denunciado e tópico', async () => {
    const { service, ids, celular } = await tresContraBruno();
    const { grupos, sugestoes } = await service.gruposDaTurma(PROF, TURMA);
    expect(grupos).toEqual([]);
    expect(sugestoes).toEqual([
      expect.objectContaining({
        denunciadoAlunoId: 'a2',
        denunciadoNome: 'Bruno',
        topicoId: celular.id,
        topicoTitulo: 'Celular',
        denunciaIds: [ids[0], ids[1]],
      }),
    ]);
  });

  it('agrupar marca as denúncias; a sugestão some; a lista traz o grupoId', async () => {
    const { service, ids, denuncias } = await tresContraBruno();
    const g = await service.criarGrupo(PROF, TURMA, [ids[1], ids[0]]);
    expect(g.denunciaIds).toEqual([ids[0], ids[1]]);
    expect(denuncias.get(ids[0])!.grupoId).toBe(g.id);
    expect(denuncias.get(ids[1])!.grupoId).toBe(g.id);
    const { grupos, sugestoes } = await service.gruposDaTurma(PROF, TURMA);
    expect(sugestoes).toEqual([]);
    expect(grupos[0]).toMatchObject({
      id: g.id,
      denunciadoNome: 'Bruno',
      xpDenunciado: 500,
      topicoTitulo: 'Celular',
      pontosSugeridos: 900,
      status: 'PENDENTE',
    });
    const lista = await service.listarDaTurma(PROF, TURMA);
    expect(lista.find((d) => d.id === ids[0])!.grupoId).toBe(g.id);
  });

  it('associar uma de outro motivo avisa; desassociar até 1 desfaz o grupo', async () => {
    const { service, ids, denuncias, grupos } = await tresContraBruno();
    const g = await service.criarGrupo(PROF, TURMA, [ids[0], ids[1]]);
    expect(await service.associarAoGrupo(PROF, TURMA, g.id, ids[2])).toEqual({
      motivoDiferente: true,
    });
    expect(grupos.get(g.id)!.denunciaIds).toEqual(ids);
    expect(denuncias.get(ids[2])!.grupoId).toBe(g.id);

    expect(await service.desassociarDoGrupo(PROF, TURMA, g.id, ids[2])).toEqual(
      { desfeito: false },
    );
    expect(denuncias.get(ids[2])!.grupoId).toBeNull();
    expect(await service.desassociarDoGrupo(PROF, TURMA, g.id, ids[1])).toEqual(
      { desfeito: true },
    );
    expect(grupos.has(g.id)).toBe(false);
    expect(denuncias.get(ids[0])!.grupoId).toBeNull();
    expect(denuncias.get(ids[1])!.grupoId).toBeNull();
  });

  it('recusa agrupar denunciado diferente, resolvida e de outra turma', async () => {
    const { service, ids, alunos } = await tresContraBruno();
    const outra = await service.criarDoAluno(aluno('a2'), {
      denunciadoAlunoId: 'a3',
      texto: 'x',
    });
    await expect(
      service.criarGrupo(PROF, TURMA, [ids[0], outra.id]),
    ).rejects.toThrow(BadRequestException);
    await service.invalidar(PROF, TURMA, ids[2]);
    await expect(
      service.criarGrupo(PROF, TURMA, [ids[0], ids[2]]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.criarGrupo(PROF, TURMA, [ids[0], 'nao-existe']),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.criarGrupo('prof-2', TURMA, [ids[0], ids[1]]),
    ).rejects.toThrow(NotFoundException);
    expect(alunos.a2.xpTotal).toBe(500);
  });

  it('avulsa que está em grupo não é validada nem invalidada sozinha: 409', async () => {
    const { service, ids } = await tresContraBruno();
    await service.criarGrupo(PROF, TURMA, [ids[0], ids[1]]);
    await expect(service.validar(PROF, TURMA, ids[0], 100)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.invalidar(PROF, TURMA, ids[0])).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('DenunciaService — validar e invalidar grupo (033)', () => {
  /** Ana (a1, 5000 XP), Caio (a3) e Duda (a4) denunciam Bruno (a2, 500 XP). */
  async function grupoDeTres(opcoes?: { pontuacaoAtiva?: boolean }) {
    const ctx = montar(opcoes);
    ctx.alunos.a4 = new AlunoEntity({
      id: 'a4',
      turmaId: TURMA,
      nome: 'Duda',
      xpTotal: 0,
    });
    ctx.alunos.a2.xpTotal = 5000;
    const ids: string[] = [];
    for (const autor of ['a1', 'a3', 'a4']) {
      ids.push(
        (
          await ctx.service.criarDoAluno(aluno(autor), {
            denunciadoAlunoId: 'a2',
            texto: `vi o celular (${autor})`,
          })
        ).id,
      );
      await new Promise((ok) => setTimeout(ok, 2));
    }
    // a segunda denúncia tem foto de legado
    const path = `denuncias/${TURMA}/${ids[1]}.jpg`;
    ctx.denuncias.get(ids[1])!.imagemPath = path;
    ctx.imagens.salvas.add(path);
    const g = await ctx.service.criarGrupo(PROF, TURMA, ids);
    return { ...ctx, ids, grupoId: g.id, path };
  }

  it('tira uma pontuação do denunciado e divide entre os autores (1000 → 334/333/333)', async () => {
    const { service, alunos, denuncias, grupos, grupoId, ids, xpLogs } =
      await grupoDeTres();
    const r = await service.validarGrupo(PROF, TURMA, grupoId, 1000);
    expect(r.pontosTransferidos).toBe(1000);
    expect(r.partes).toEqual([
      { alunoId: 'a1', pontos: 334 },
      { alunoId: 'a3', pontos: 333 },
      { alunoId: 'a4', pontos: 333 },
    ]);
    expect(alunos.a2.xpTotal).toBe(4000);
    expect(alunos.a1.xpTotal).toBe(5334);
    expect(alunos.a3.xpTotal).toBe(333);
    expect(alunos.a4.xpTotal).toBe(333);
    expect(xpLogs.filter((l) => l.alunoId === 'a2')).toEqual([
      { alunoId: 'a2', pontos: -1000, motivo: 'DENUNCIA' },
    ]);
    expect(grupos.get(grupoId)).toMatchObject({
      status: 'VALIDADO',
      pontos: 1000,
      pontosTransferidos: 1000,
    });
    expect(ids.map((id) => denuncias.get(id)!.status)).toEqual([
      'VALIDADA',
      'VALIDADA',
      'VALIDADA',
    ]);
    expect(ids.map((id) => denuncias.get(id)!.pontosTransferidos)).toEqual([
      334, 333, 333,
    ]);
  });

  it('o que sai é limitado ao XP do denunciado', async () => {
    const { service, alunos, grupoId } = await grupoDeTres();
    alunos.a2.xpTotal = 100;
    const r = await service.validarGrupo(PROF, TURMA, grupoId, 9000);
    expect(r.pontosTransferidos).toBe(100);
    expect(alunos.a2.xpTotal).toBe(0);
    expect(r.partes.map((p) => p.pontos)).toEqual([34, 33, 33]);
  });

  it('apaga a foto de legado ao validar e ao invalidar', async () => {
    const a = await grupoDeTres();
    await a.service.validarGrupo(PROF, TURMA, a.grupoId, 10);
    expect(a.imagens.salvas.has(a.path)).toBe(false);
    expect(a.denuncias.get(a.ids[1])!.imagemPath).toBeNull();

    const b = await grupoDeTres();
    await b.service.invalidarGrupo(PROF, TURMA, b.grupoId);
    expect(b.imagens.salvas.has(b.path)).toBe(false);
  });

  it('invalidar invalida todas e não mexe no XP', async () => {
    const { service, alunos, denuncias, grupos, grupoId, ids, xpLogs } =
      await grupoDeTres();
    await service.invalidarGrupo(PROF, TURMA, grupoId);
    expect(grupos.get(grupoId)!.status).toBe('INVALIDADO');
    expect(ids.every((id) => denuncias.get(id)!.status === 'INVALIDADA')).toBe(
      true,
    );
    expect(alunos.a2.xpTotal).toBe(5000);
    expect(xpLogs).toEqual([]);
  });

  it('resolver o grupo duas vezes é 409 e não transfere de novo', async () => {
    const { service, alunos, grupoId } = await grupoDeTres();
    await service.validarGrupo(PROF, TURMA, grupoId, 300);
    await expect(
      service.validarGrupo(PROF, TURMA, grupoId, 300),
    ).rejects.toThrow(ConflictException);
    await expect(service.invalidarGrupo(PROF, TURMA, grupoId)).rejects.toThrow(
      ConflictException,
    );
    expect(alunos.a2.xpTotal).toBe(4700);
  });

  it('recusa acima de 10.000, grupo de outra turma e de outro professor', async () => {
    const { service, grupoId } = await grupoDeTres();
    await expect(
      service.validarGrupo(PROF, TURMA, grupoId, 10001),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.validarGrupo(PROF, TURMA, 'nao-existe', 10),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.validarGrupo('prof-2', TURMA, grupoId, 10),
    ).rejects.toThrow(NotFoundException);
  });

  it('turma sem pontuação: valida o grupo sem mexer no XP', async () => {
    const { service, alunos, denuncias, grupos, grupoId, ids } =
      await grupoDeTres({ pontuacaoAtiva: false });
    await service.validarGrupo(PROF, TURMA, grupoId, 600);
    expect(alunos.a2.xpTotal).toBe(5000);
    expect(grupos.get(grupoId)).toMatchObject({
      status: 'VALIDADO',
      pontosTransferidos: 0,
    });
    expect(ids.map((id) => denuncias.get(id)!.pontosTransferidos)).toEqual([
      0, 0, 0,
    ]);
  });

  it('anonimato: o autor vê só a dele, sem grupo nem outros autores; o denunciado tem um só lançamento', async () => {
    const { service, grupoId, xpLogs } = await grupoDeTres();
    await service.validarGrupo(PROF, TURMA, grupoId, 900);
    const minhas = await service.minhasDoAluno(aluno('a3'));
    expect(minhas).toHaveLength(1);
    expect(minhas[0]).not.toHaveProperty('grupoId');
    expect(minhas[0]).not.toHaveProperty('autorAlunoId');
    expect(JSON.stringify(minhas)).not.toMatch(/Ana|Duda/);
    expect(await service.minhasDoAluno(aluno('a2'))).toEqual([]);
    expect(xpLogs.filter((l) => l.alunoId === 'a2')).toHaveLength(1);
  });
});
