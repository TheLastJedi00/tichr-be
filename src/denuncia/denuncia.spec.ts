import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
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
    async (_tx: unknown, id: string) => denuncias.get(id)!;
  (
    denunciaRepo as unknown as { gravarNaTransacao: unknown }
  ).gravarNaTransacao = (
    _tx: unknown,
    id: string,
    patch: Partial<DenunciaEntity>,
  ) => Object.assign(denuncias.get(id)!, patch);

  const service = new DenunciaService(
    denunciaRepo,
    topicoRepo,
    turmaRepo,
    alunoRepo,
    xp,
    professorService,
    imagens as unknown as DenunciaImagemStorage,
    janelaRepo,
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

  it('cria com tópico, texto e imagem privada', async () => {
    const { service, denuncias, imagens } = montar();
    const tp = await service.criarTopico(PROF, {
      titulo: 'Celular',
      pontosSugeridos: 100,
    });
    await service.criarDoAluno(
      aluno('a1'),
      { denunciadoAlunoId: 'a2', topicoId: tp.id, texto: ' no recreio ' },
      jpeg,
    );
    const d = [...denuncias.values()][0];
    expect(d).toMatchObject({
      autorAlunoId: 'a1',
      denunciadoAlunoId: 'a2',
      topicoTitulo: 'Celular',
      texto: 'no recreio',
      status: 'PENDENTE',
      professorId: PROF,
    });
    expect(d.imagemPath).toBe(`denuncias/${TURMA}/${d.id}.jpg`);
    expect(imagens.salvas.has(d.imagemPath!)).toBe(true);
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

  it('recusa imagem que não é imagem ou é grande demais', async () => {
    const { service } = montar();
    await expect(
      service.criarDoAluno(
        aluno('a1'),
        { denunciadoAlunoId: 'a2', texto: 'x' },
        { ...jpeg, mimetype: 'text/plain' },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.criarDoAluno(
        aluno('a1'),
        { denunciadoAlunoId: 'a2', texto: 'x' },
        { ...jpeg, size: 10 * 1024 * 1024 },
      ),
    ).rejects.toThrow(PayloadTooLargeException);
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
    await ctx.service.criarDoAluno(
      aluno('a1'),
      { denunciadoAlunoId: 'a2', texto: 'celular' },
      jpeg,
    );
    return { ...ctx, id: [...ctx.denuncias.keys()][0] };
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
