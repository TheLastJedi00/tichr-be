import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoEntity } from '../turma/entities/aluno.entity';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { PerguntaMensagemEntity } from './entities/pergunta-mensagem.entity';
import { PerguntaEntity } from './entities/pergunta.entity';
import { AnexoStorage } from '../common/anexo.storage';
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

  const ctl = { falharUpload: false, falharTx: false };
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
      if (ctl.falharTx) throw new Error('conflito na transação');
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

  const service = new PerguntaService(
    perguntaRepo,
    mensagemRepo,
    turmaRepo,
    alunoRepo,
    professorService,
    storage,
  );
  return {
    service,
    perguntas,
    mensagens,
    turmas,
    ctl,
    arquivos,
    apagados,
    urls,
  };
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

const ANA = { alunoId: 'a1', turmaId: TURMA };
const BRUNO = { alunoId: 'a2', turmaId: TURMA };

function codigoDe(e: unknown): string | undefined {
  const r = (e as { getResponse?: () => unknown }).getResponse?.();
  return (r as { code?: string })?.code;
}

async function falha(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('deveria ter falhado');
}

describe('PerguntaService — aluno', () => {
  it('cria pergunta com a 1ª mensagem, esperando o professor', async () => {
    const { service, perguntas, mensagens } = montar();
    const { id } = await service.criarDoAluno(ANA, {
      titulo: 'Prova',
      texto: 'Cai a unidade 2?',
    });
    const p = perguntas.get(id)!;
    expect(p.professorId).toBe(PROF);
    expect(p.alunoId).toBe('a1');
    expect(p.totalMensagens).toBe(1);
    const ms = [...mensagens.values()];
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      perguntaId: id,
      autor: 'ALUNO',
      texto: 'Cai a unidade 2?',
    });
    const [minha] = await service.minhasDoAluno(ANA);
    expect(minha).toMatchObject({
      id,
      titulo: 'Prova',
      aguardando: 'AGUARDANDO_PROFESSOR',
    });
  });

  it('pergunta sem texto nem anexo: 400 MENSAGEM_VAZIA', async () => {
    const { service, perguntas } = montar();
    const e = await falha(service.criarDoAluno(ANA, { titulo: 'Prova' }));
    expect(codigoDe(e)).toBe('MENSAGEM_VAZIA');
    expect(perguntas.size).toBe(0);
  });

  it('janela fechada: não cria nem responde (403), mas lê e encerra', async () => {
    const { service, turmas } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'b' });
    turmas[TURMA].perguntasAbertas = false;
    expect(await service.estadoAluno(ANA)).toEqual({ abertas: false });
    for (const p of [
      service.criarDoAluno(ANA, { titulo: 'B', texto: 'c' }),
      service.responderDoAluno(ANA, id, { texto: 'mais' }),
    ]) {
      const e = await falha(p);
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(codigoDe(e)).toBe('PERGUNTAS_FECHADAS');
    }
    expect((await service.detalheDoAluno(ANA, id)).mensagens).toHaveLength(1);
    await service.encerrarDoAluno(ANA, id);
    expect((await service.detalheDoAluno(ANA, id)).pergunta.status).toBe(
      'ENCERRADA',
    );
  });

  it('6ª aberta: 409; encerrada não conta', async () => {
    const { service } = montar();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        (await service.criarDoAluno(ANA, { titulo: `P${i}`, texto: 'x' })).id,
      );
    }
    const e = await falha(
      service.criarDoAluno(ANA, { titulo: 'P6', texto: 'x' }),
    );
    expect(codigoDe(e)).toBe('LIMITE_PERGUNTAS');
    await service.encerrarDoAluno(ANA, ids[0]);
    await expect(
      service.criarDoAluno(ANA, { titulo: 'P6', texto: 'x' }),
    ).resolves.toBeDefined();
    // Outro aluno tem a própria cota.
    await expect(
      service.criarDoAluno(BRUNO, { titulo: 'P1', texto: 'x' }),
    ).resolves.toBeDefined();
  });

  it('não enxerga nem mexe na pergunta de outro aluno (404)', async () => {
    const { service } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'b' });
    for (const p of [
      service.detalheDoAluno(BRUNO, id),
      service.responderDoAluno(BRUNO, id, { texto: 'oi' }),
      service.encerrarDoAluno(BRUNO, id),
    ]) {
      expect(await falha(p)).toBeInstanceOf(NotFoundException);
    }
    expect(await service.minhasDoAluno(BRUNO)).toEqual([]);
  });

  it('responder encerrada: 409 PERGUNTA_ENCERRADA', async () => {
    const { service } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'b' });
    await service.encerrarDoAluno(ANA, id);
    const e = await falha(service.responderDoAluno(ANA, id, { texto: 'c' }));
    expect(codigoDe(e)).toBe('PERGUNTA_ENCERRADA');
  });

  it('fora do PhD: 403 também para o aluno', async () => {
    const { service } = montar({ podeGamificar: false });
    await expect(service.estadoAluno(ANA)).rejects.toThrow(ForbiddenException);
  });
});

describe('PerguntaService — professor', () => {
  it('lista com o nome do aluno, aguardando professor primeiro', async () => {
    const { service } = montar();
    const a = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'a' });
    const b = await service.criarDoAluno(BRUNO, { titulo: 'B', texto: 'b' });
    await service.responderDoProfessor(PROF, TURMA, b.id, { texto: 'r' });
    const lista = await service.listarDaTurma(PROF, TURMA);
    expect(lista.map((p) => [p.id, p.alunoNome, p.aguardando])).toEqual([
      [a.id, 'Ana', 'AGUARDANDO_PROFESSOR'],
      [b.id, 'Bruno', 'AGUARDANDO_ALUNO'],
    ]);
  });

  it('responde com a janela fechada; a conversa sai em ordem', async () => {
    const { service, turmas } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: '1' });
    turmas[TURMA].perguntasAbertas = false;
    await service.responderDoProfessor(PROF, TURMA, id, { texto: '2' });
    const d = await service.detalheDoProfessor(PROF, TURMA, id);
    expect(d.mensagens.map((m) => [m.autor, m.texto])).toEqual([
      ['ALUNO', '1'],
      ['PROFESSOR', '2'],
    ]);
    expect(d.pergunta.aguardando).toBe('AGUARDANDO_ALUNO');
    expect(d.pergunta.totalMensagens).toBe(2);
  });

  it('encerra e reabre; reabrir aberta: 409', async () => {
    const { service } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: '1' });
    const e = await falha(service.reabrir(PROF, TURMA, id));
    expect(codigoDe(e)).toBe('PERGUNTA_ABERTA');
    await service.encerrarDoProfessor(PROF, TURMA, id);
    let d = await service.detalheDoProfessor(PROF, TURMA, id);
    expect(d.pergunta).toMatchObject({
      status: 'ENCERRADA',
      encerradaPor: 'PROFESSOR',
      aguardando: null,
    });
    await service.reabrir(PROF, TURMA, id);
    d = await service.detalheDoProfessor(PROF, TURMA, id);
    expect(d.pergunta.status).toBe('ABERTA');
  });

  it('filtra por status', async () => {
    const { service } = montar();
    const a = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'a' });
    await service.criarDoAluno(BRUNO, { titulo: 'B', texto: 'b' });
    await service.encerrarDoProfessor(PROF, TURMA, a.id);
    expect(
      (await service.listarDaTurma(PROF, TURMA, 'ENCERRADA')).map((p) => p.id),
    ).toEqual([a.id]);
    expect(await service.listarDaTurma(PROF, TURMA, 'ABERTA')).toHaveLength(1);
  });

  it('professor de outra turma: 404', async () => {
    const { service } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: '1' });
    await expect(
      service.detalheDoProfessor('prof-2', TURMA, id),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.detalheDoProfessor('prof-2', 'outra', id),
    ).rejects.toThrow(NotFoundException);
  });

  it('pendentes conta só as que esperam o professor, por turma', async () => {
    const { service } = montar();
    const a = await service.criarDoAluno(ANA, { titulo: 'A', texto: 'a' });
    const b = await service.criarDoAluno(BRUNO, { titulo: 'B', texto: 'b' });
    await service.criarDoAluno(BRUNO, { titulo: 'C', texto: 'c' });
    await service.responderDoProfessor(PROF, TURMA, a.id, { texto: 'r' });
    await service.encerrarDoProfessor(PROF, TURMA, b.id);
    expect(await service.pendentesPorTurma(PROF)).toEqual({ [TURMA]: 1 });
  });

  it('a mensagem nunca expõe o caminho do anexo', async () => {
    const { service, mensagens } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'A', texto: '1' });
    const m = [...mensagens.values()][0];
    m.anexo = {
      path: 'perguntas/x',
      nome: 'a.pdf',
      extensao: 'pdf',
      tamanho: 3,
    };
    const d = await service.detalheDoProfessor(PROF, TURMA, id);
    expect(d.mensagens[0].anexo).toEqual({
      nome: 'a.pdf',
      extensao: 'pdf',
      tamanho: 3,
    });
    expect(JSON.stringify(await service.detalheDoAluno(ANA, id))).not.toContain(
      'perguntas/x',
    );
  });
});

const PDF = {
  originalname: 'trabalho.pdf',
  buffer: Buffer.from('%PDF-1.7 conteúdo'),
};
const HTML = {
  originalname: 'site.html',
  buffer: Buffer.from('<script>alert(1)</script>', 'utf8'),
};
const PNG = {
  originalname: 'foto.png',
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
};

describe('PerguntaService — anexo (#12–#16)', () => {
  it('cria pergunta com PDF: sobe privado e marca temAnexo', async () => {
    const { service, perguntas, mensagens, arquivos } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'Trab' }, PDF);
    const m = [...mensagens.values()][0];
    expect(m.anexo).toMatchObject({
      path: `perguntas/${TURMA}/${id}/${m.id}`,
      nome: 'trabalho.pdf',
      extensao: 'pdf',
    });
    expect(arquivos.get(m.anexo!.path)?.contentType).toBe('application/pdf');
    expect(perguntas.get(id)!.temAnexo).toBe(true);
  });

  it('imagem é recusada antes de subir qualquer coisa', async () => {
    const { service, perguntas, arquivos } = montar();
    const e = await falha(
      service.criarDoAluno(ANA, { titulo: 'Foto', texto: 'x' }, PNG),
    );
    expect(codigoDe(e)).toBe('TIPO_ARQUIVO_NAO_ACEITO');
    expect(perguntas.size).toBe(0);
    expect(arquivos.size).toBe(0);
  });

  it('upload falhou: 502 e nada é gravado', async () => {
    const { service, perguntas, mensagens, ctl } = montar();
    ctl.falharUpload = true;
    const e = await falha(service.criarDoAluno(ANA, { titulo: 'T' }, PDF));
    expect(codigoDe(e)).toBe('ANEXO_FALHOU');
    expect(perguntas.size).toBe(0);
    expect(mensagens.size).toBe(0);
  });

  it('transação recusou depois do upload: o arquivo é apagado', async () => {
    const { service, ctl, arquivos, apagados } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'T', texto: 'a' });
    ctl.falharTx = true;
    await expect(service.responderDoAluno(ANA, id, {}, PDF)).rejects.toThrow(
      'conflito',
    );
    expect(apagados).toHaveLength(1);
    expect(arquivos.size).toBe(0);
  });

  it('encerrada: recusa antes de subir o arquivo', async () => {
    const { service, arquivos } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'T', texto: 'a' });
    await service.encerrarDoAluno(ANA, id);
    const e = await falha(service.responderDoAluno(ANA, id, {}, PDF));
    expect(codigoDe(e)).toBe('PERGUNTA_ENCERRADA');
    expect(arquivos.size).toBe(0);
  });

  it('download: HTML sai como texto simples, com o nome original', async () => {
    const { service, mensagens, urls } = montar();
    const { id } = await service.criarDoAluno(ANA, { titulo: 'Site' }, HTML);
    const m = [...mensagens.values()][0];
    const r = await service.anexoDoProfessor(PROF, TURMA, id, m.id);
    expect(r.url).toContain(m.anexo!.path);
    expect(urls[0]).toEqual({
      path: m.anexo!.path,
      nome: 'site.html',
      contentType: 'text/plain; charset=utf-8',
    });
    await expect(service.anexoDoAluno(ANA, id, m.id)).resolves.toBeDefined();
  });

  it('download protegido: outro aluno, mensagem sem anexo ou de outra pergunta', async () => {
    const { service, mensagens } = montar();
    const a = await service.criarDoAluno(ANA, { titulo: 'A' }, PDF);
    const b = await service.criarDoAluno(ANA, { titulo: 'B', texto: 'só' });
    const [ma, mb] = [...mensagens.values()];
    for (const p of [
      service.anexoDoAluno(BRUNO, a.id, ma.id),
      service.anexoDoProfessor(PROF, TURMA, b.id, mb.id),
      service.anexoDoProfessor(PROF, TURMA, b.id, ma.id),
      service.anexoDoProfessor('prof-2', TURMA, a.id, ma.id),
    ]) {
      expect(await falha(p)).toBeInstanceOf(NotFoundException);
    }
  });
});
