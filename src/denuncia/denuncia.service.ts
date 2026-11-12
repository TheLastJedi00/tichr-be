import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { XpService } from '../turma/xp.service';
import { DenunciaImagemStorage } from './denuncia-imagem.storage';
import { DenunciaJanelaRepository } from './denuncia-janela.repository';
import { DenunciaGrupoRepository } from './denuncia-grupo.repository';
import {
  DenunciaGrupoEntity,
  StatusGrupo,
} from './entities/denuncia-grupo.entity';
import { DenunciaTopicoRepository } from './denuncia-topico.repository';
import { DenunciaRepository } from './denuncia.repository';
import { DenunciaEntity, StatusDenuncia } from './entities/denuncia.entity';
import { DenunciaTopicoEntity } from './entities/denuncia-topico.entity';
import { DenunciaJanelaEntity } from './entities/denuncia-janela.entity';

type Aluno = { alunoId: string; turmaId: string };
/** Arquivo multipart: só para recusar a foto que um front antigo ainda mande. */
type Arquivo = { buffer: Buffer; mimetype: string; size: number };

/** O que o professor vê de cada denúncia (sem o caminho da imagem). */
export interface DenunciaProfessorView {
  id: string;
  status: StatusDenuncia;
  criadaEm: string;
  resolvidaEm?: string;
  autorAlunoId: string;
  autorNome: string;
  denunciadoAlunoId: string;
  denunciadoNome: string;
  /** XP atual do denunciado: a tela avisa quando a punição passa dele (#2). */
  xpDenunciado: number;
  /** Janela de denúncia em que foi feita (033); ausente nas anteriores. */
  janelaId?: string;
  /** Grupo de que faz parte (033). */
  grupoId?: string;
  topicoId?: string;
  topicoTitulo?: string;
  /** Pontos sugeridos do tópico, se ele ainda existir. */
  pontosSugeridos?: number;
  texto?: string;
  temImagem: boolean;
  pontos?: number;
  pontosTransferidos?: number;
}

/** Um grupo de denúncias contra o mesmo aluno, para o professor (033). */
export interface GrupoProfessorView {
  id: string;
  status: StatusGrupo;
  criadoEm: string;
  resolvidoEm?: string;
  denunciadoAlunoId: string;
  denunciadoNome: string;
  xpDenunciado: number;
  topicoId?: string;
  topicoTitulo?: string;
  pontosSugeridos?: number;
  /** Ordem cronológica: é a ordem da sobra na divisão. */
  denunciaIds: string[];
  pontos?: number;
  pontosTransferidos?: number;
}

/** Pendentes avulsas com o mesmo denunciado e tópico: o professor confirma. */
export interface SugestaoGrupoView {
  denunciadoAlunoId: string;
  denunciadoNome: string;
  topicoId: string;
  topicoTitulo?: string;
  denunciaIds: string[];
}

/** O que o autor vê das próprias denúncias: nada de pontos nem do autor. */
export interface DenunciaAlunoView {
  id: string;
  status: StatusDenuncia;
  criadaEm: string;
  denunciadoNome: string;
  topicoTitulo?: string;
  texto?: string;
}

/**
 * Denúncia entre alunos (spec 032). O aluno denuncia pelo portal; o professor
 * valida (transferindo XP do denunciado ao autor) ou invalida.
 */
@Injectable()
export class DenunciaService {
  constructor(
    private readonly denuncias: DenunciaRepository,
    private readonly topicos: DenunciaTopicoRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly xp: XpService,
    private readonly professorService: ProfessorService,
    private readonly imagens: DenunciaImagemStorage,
    private readonly janelaRepo: DenunciaJanelaRepository,
    private readonly grupos: DenunciaGrupoRepository,
  ) {}

  // ===== Tópicos (professor) =====

  async listarTopicos(professorId: string): Promise<DenunciaTopicoEntity[]> {
    await this.assertPlano(professorId);
    return this.topicosAtivos(professorId);
  }

  async criarTopico(
    professorId: string,
    dto: { titulo: string; pontosSugeridos: number },
  ): Promise<DenunciaTopicoEntity> {
    await this.assertPlano(professorId);
    const ok = DenunciaTopicoEntity.validar(dto);
    return this.topicos.create({
      professorId,
      titulo: ok.titulo!,
      pontosSugeridos: ok.pontosSugeridos!,
      ativo: true,
      criadoEm: new Date().toISOString(),
    });
  }

  async editarTopico(
    professorId: string,
    id: string,
    dto: { titulo?: string; pontosSugeridos?: number; ativo?: boolean },
  ): Promise<DenunciaTopicoEntity> {
    await this.assertPlano(professorId);
    const topico = await this.topicos.findById(id);
    if (!topico || topico.professorId !== professorId) {
      throw new NotFoundException('Tópico não encontrado.');
    }
    const patch: Partial<DenunciaTopicoEntity> =
      DenunciaTopicoEntity.validar(dto);
    if (dto.ativo !== undefined) patch.ativo = dto.ativo;
    await this.topicos.update(id, patch);
    return Object.assign(topico, patch);
  }

  // ===== Aluno =====

  async opcoesAluno({ alunoId, turmaId }: Aluno): Promise<{
    abertas: boolean;
    colegas: Array<{ id: string; nome: string }>;
    topicos: Array<{ id: string; titulo: string }>;
  }> {
    const turma = await this.turmaDoAluno(turmaId);
    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const colegas = alunos
      .filter((a) => a.id !== alunoId)
      .map((a) => ({ id: a.id, nome: a.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    // A pontuação sugerida é assunto do professor: não vai ao aluno.
    const topicos = (await this.topicosAtivos(turma.professorId)).map((t) => ({
      id: t.id,
      titulo: t.titulo,
    }));
    return { abertas: turma.denunciasAbertas === true, colegas, topicos };
  }

  async criarDoAluno(
    { alunoId, turmaId }: Aluno,
    dto: { denunciadoAlunoId: string; topicoId?: string; texto?: string },
    imagem?: Arquivo,
  ): Promise<{ id: string }> {
    // 033 #1: a foto saiu. Recusar (em vez de ignorar) avisa o front antigo
    // em cache de que a imagem não foi enviada.
    if (imagem) {
      throw new BadRequestException({
        code: 'IMAGEM_REMOVIDA',
        message: 'A denúncia não aceita mais imagem. Descreva o que aconteceu.',
      });
    }
    const turma = await this.turmaDoAluno(turmaId);
    if (turma.denunciasAbertas !== true) {
      throw new ForbiddenException({
        code: 'DENUNCIAS_FECHADAS',
        message:
          'As denúncias estão fechadas. O professor abre durante a aula.',
      });
    }
    const denunciado = await this.alunoRepo.findById(dto.denunciadoAlunoId);
    if (!denunciado || denunciado.turmaId !== turmaId) {
      throw new NotFoundException('Colega não encontrado nesta turma.');
    }
    let topico: DenunciaTopicoEntity | null = null;
    if (dto.topicoId) {
      topico = await this.topicos.findById(dto.topicoId);
      if (
        !topico ||
        topico.professorId !== turma.professorId ||
        !topico.ativo
      ) {
        throw new NotFoundException('Tópico não encontrado.');
      }
    }

    const doAutor = await this.denuncias.findBy('autorAlunoId', alunoId);
    const nova = DenunciaEntity.criar(
      {
        turmaId,
        professorId: turma.professorId,
        autorAlunoId: alunoId,
        denunciadoAlunoId: denunciado.id,
        topico,
        texto: dto.texto,
      },
      doAutor,
    );
    if (turma.denunciaJanelaId) nova.janelaId = turma.denunciaJanelaId;
    const criada = await this.denuncias.create(nova);
    return { id: criada.id };
  }

  async minhasDoAluno({
    alunoId,
    turmaId,
  }: Aluno): Promise<DenunciaAlunoView[]> {
    const doAutor = (
      await this.denuncias.findBy('autorAlunoId', alunoId)
    ).filter((d) => d.turmaId === turmaId);
    const nomes = await this.nomesDaTurma(turmaId);
    return this.maisNovas(doAutor).map((d) => {
      const v: DenunciaAlunoView = {
        id: d.id,
        status: d.status,
        criadaEm: d.criadaEm,
        denunciadoNome: nomes.get(d.denunciadoAlunoId)?.nome ?? 'Colega',
      };
      if (d.topicoTitulo) v.topicoTitulo = d.topicoTitulo;
      if (d.texto) v.texto = d.texto;
      return v;
    });
  }

  // ===== Professor =====

  async listarDaTurma(
    professorId: string,
    turmaId: string,
    status?: StatusDenuncia,
  ): Promise<DenunciaProfessorView[]> {
    await this.turmaDoProfessor(professorId, turmaId);
    const todas = (await this.denuncias.findBy('turmaId', turmaId)).filter(
      (d) => !status || d.status === status,
    );
    const nomes = await this.nomesDaTurma(turmaId);
    const topicos = new Map(
      (await this.topicos.findBy('professorId', professorId)).map((t) => [
        t.id,
        t,
      ]),
    );
    return this.maisNovas(todas).map((d) => {
      const autor = nomes.get(d.autorAlunoId);
      const denunciado = nomes.get(d.denunciadoAlunoId);
      const v: DenunciaProfessorView = {
        id: d.id,
        status: d.status,
        criadaEm: d.criadaEm,
        autorAlunoId: d.autorAlunoId,
        autorNome: autor?.nome ?? 'Aluno removido',
        denunciadoAlunoId: d.denunciadoAlunoId,
        denunciadoNome: denunciado?.nome ?? 'Aluno removido',
        xpDenunciado: denunciado?.xpTotal ?? 0,
        temImagem: !!d.imagemPath,
      };
      if (d.resolvidaEm) v.resolvidaEm = d.resolvidaEm;
      if (d.janelaId) v.janelaId = d.janelaId;
      if (d.grupoId) v.grupoId = d.grupoId;
      if (d.topicoId) {
        v.topicoId = d.topicoId;
        v.topicoTitulo = d.topicoTitulo;
        const t = topicos.get(d.topicoId);
        if (t) v.pontosSugeridos = t.pontosSugeridos;
      }
      if (d.texto) v.texto = d.texto;
      if (d.pontos !== undefined) v.pontos = d.pontos;
      if (d.pontosTransferidos !== undefined) {
        v.pontosTransferidos = d.pontosTransferidos;
      }
      return v;
    });
  }

  async urlImagem(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<{ url: string }> {
    const d = await this.denunciaDoProfessor(professorId, turmaId, id);
    if (!d.imagemPath) {
      throw new NotFoundException('Essa denúncia não tem imagem.');
    }
    return { url: await this.imagens.urlAssinada(d.imagemPath) };
  }

  async validar(
    professorId: string,
    turmaId: string,
    id: string,
    pontos: number,
  ): Promise<{ pontosTransferidos: number }> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    const d = await this.denunciaDoProfessor(professorId, turmaId, id, turma);
    DenunciaTopicoEntity.pontosValidos(pontos);
    d.assertPendente();
    d.assertAvulsa();
    const imagem = d.imagemPath;

    const patch = (transferidos: number): Partial<DenunciaEntity> => ({
      status: 'VALIDADA',
      resolvidaEm: new Date().toISOString(),
      pontos,
      pontosTransferidos: transferidos,
      imagemPath: null as unknown as undefined,
    });

    let transferidos = 0;
    if (turma.configPontuacao.pontuacaoAtiva && pontos > 0) {
      // A checagem de pendente e a transferência vão no MESMO commit: duas
      // validações simultâneas não transferem duas vezes.
      transferidos = await this.xp.transferir({
        turmaId,
        deAlunoId: d.denunciadoAlunoId,
        paraAlunoId: d.autorAlunoId,
        pontos,
        motivo: 'DENUNCIA',
        noMesmoCommit: {
          ler: async (tx) => {
            const atual = await this.denuncias.lerNaTransacao(tx, id);
            atual.assertPendente();
            atual.assertAvulsa();
          },
          gravar: (tx, t) => this.denuncias.gravarNaTransacao(tx, id, patch(t)),
        },
      });
    } else {
      await this.denuncias.resolverSePendente(id, patch(0));
    }
    if (imagem) await this.imagens.apagar(imagem);
    return { pontosTransferidos: transferidos };
  }

  async invalidar(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<void> {
    const d = await this.denunciaDoProfessor(professorId, turmaId, id);
    d.assertPendente();
    d.assertAvulsa();
    const imagem = d.imagemPath;
    await this.denuncias.resolverSePendente(id, {
      status: 'INVALIDADA',
      resolvidaEm: new Date().toISOString(),
      imagemPath: null as unknown as undefined,
    });
    if (imagem) await this.imagens.apagar(imagem);
  }

  // ===== Grupos (033) =====

  /** Grupos da turma (todos os status) e sugestões entre as pendentes avulsas. */
  async gruposDaTurma(
    professorId: string,
    turmaId: string,
  ): Promise<{ grupos: GrupoProfessorView[]; sugestoes: SugestaoGrupoView[] }> {
    await this.turmaDoProfessor(professorId, turmaId);
    const nomes = await this.nomesDaTurma(turmaId);
    const topicos = new Map(
      (await this.topicos.findBy('professorId', professorId)).map((t) => [
        t.id,
        t,
      ]),
    );
    const denuncias = await this.denuncias.findBy('turmaId', turmaId);
    const tituloDe = (topicoId?: string) =>
      topicoId
        ? (denuncias.find((d) => d.topicoId === topicoId)?.topicoTitulo ??
          topicos.get(topicoId)?.titulo)
        : undefined;

    const grupos = (await this.grupos.findBy('turmaId', turmaId))
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      .map((g) => {
        const alvo = nomes.get(g.denunciadoAlunoId);
        const v: GrupoProfessorView = {
          id: g.id,
          status: g.status,
          criadoEm: g.criadoEm,
          denunciadoAlunoId: g.denunciadoAlunoId,
          denunciadoNome: alvo?.nome ?? 'Aluno removido',
          xpDenunciado: alvo?.xpTotal ?? 0,
          denunciaIds: g.denunciaIds,
        };
        if (g.resolvidoEm) v.resolvidoEm = g.resolvidoEm;
        if (g.topicoId) {
          v.topicoId = g.topicoId;
          const titulo = tituloDe(g.topicoId);
          if (titulo) v.topicoTitulo = titulo;
          const t = topicos.get(g.topicoId);
          if (t) v.pontosSugeridos = t.pontosSugeridos;
        }
        if (g.pontos !== undefined) v.pontos = g.pontos;
        if (g.pontosTransferidos !== undefined) {
          v.pontosTransferidos = g.pontosTransferidos;
        }
        return v;
      });

    const porChave = new Map<string, DenunciaEntity[]>();
    for (const d of denuncias) {
      if (!d.pendente || d.grupoId || !d.topicoId) continue;
      const chave = `${d.denunciadoAlunoId}|${d.topicoId}`;
      porChave.set(chave, [...(porChave.get(chave) ?? []), d]);
    }
    const sugestoes: SugestaoGrupoView[] = [...porChave.values()]
      .filter((lista) => lista.length >= 2)
      .map((lista) => {
        const ordenadas = [...lista].sort(
          (a, b) =>
            a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id),
        );
        const [primeira] = ordenadas;
        const v: SugestaoGrupoView = {
          denunciadoAlunoId: primeira.denunciadoAlunoId,
          denunciadoNome:
            nomes.get(primeira.denunciadoAlunoId)?.nome ?? 'Aluno removido',
          topicoId: primeira.topicoId!,
          denunciaIds: ordenadas.map((d) => d.id),
        };
        if (primeira.topicoTitulo) v.topicoTitulo = primeira.topicoTitulo;
        return v;
      });
    return { grupos, sugestoes };
  }

  async criarGrupo(
    professorId: string,
    turmaId: string,
    denunciaIds: string[],
  ): Promise<DenunciaGrupoEntity> {
    await this.turmaDoProfessor(professorId, turmaId);
    return this.grupos.transacao(async (tx) => {
      const lidas: DenunciaEntity[] = [];
      for (const id of new Set(denunciaIds)) {
        lidas.push(await this.denunciaNaTransacao(tx, turmaId, id));
      }
      const g = DenunciaGrupoEntity.criar(lidas);
      g.id = this.grupos.novoId();
      this.grupos.gravarNaTransacao(tx, g);
      for (const id of g.denunciaIds) {
        this.denuncias.gravarNaTransacao(tx, id, { grupoId: g.id });
      }
      return g;
    });
  }

  async associarAoGrupo(
    professorId: string,
    turmaId: string,
    grupoId: string,
    denunciaId: string,
  ): Promise<{ motivoDiferente: boolean }> {
    await this.turmaDoProfessor(professorId, turmaId);
    return this.grupos.transacao(async (tx) => {
      const g = await this.grupoNaTransacao(tx, turmaId, grupoId);
      const d = await this.denunciaNaTransacao(tx, turmaId, denunciaId);
      const r = g.associar(d);
      this.grupos.gravarNaTransacao(tx, g);
      this.denuncias.gravarNaTransacao(tx, d.id, { grupoId: g.id });
      return r;
    });
  }

  async desassociarDoGrupo(
    professorId: string,
    turmaId: string,
    grupoId: string,
    denunciaId: string,
  ): Promise<{ desfeito: boolean }> {
    await this.turmaDoProfessor(professorId, turmaId);
    return this.grupos.transacao(async (tx) => {
      const g = await this.grupoNaTransacao(tx, turmaId, grupoId);
      const r = g.desassociar(denunciaId);
      const livres = r.desfeito ? [denunciaId, ...g.denunciaIds] : [denunciaId];
      for (const id of livres) {
        this.denuncias.gravarNaTransacao(tx, id, { grupoId: null });
      }
      if (r.desfeito) this.grupos.apagarNaTransacao(tx, g.id);
      else this.grupos.gravarNaTransacao(tx, g);
      return r;
    });
  }

  /**
   * Valida o grupo (033 #6): uma pontuação só sai do denunciado (no máximo o
   * XP dele) e é dividida igualmente entre os autores, com a sobra para quem
   * denunciou primeiro. Grupo, denúncias e XP no mesmo commit.
   */
  async validarGrupo(
    professorId: string,
    turmaId: string,
    grupoId: string,
    pontos: number,
  ): Promise<{
    pontosTransferidos: number;
    partes: Array<{ alunoId: string; pontos: number }>;
  }> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    DenunciaTopicoEntity.pontosValidos(pontos);
    const g = await this.grupoDoProfessor(turmaId, grupoId);
    g.assertPendente();
    const denuncias = await this.denunciasDoGrupo(g);
    const autores = denuncias.map((d) => d.autorAlunoId);
    const fotos = this.fotosDeLegado(denuncias);
    const agora = new Date().toISOString();

    const ler = async (
      tx: Parameters<DenunciaGrupoRepository['lerNaTransacao']>[0],
    ) => {
      const atual = await this.grupoNaTransacao(tx, turmaId, grupoId);
      atual.assertPendente();
      // Alguém mexeu no grupo entre a leitura e o commit: refazer a conta.
      if (atual.denunciaIds.join() !== g.denunciaIds.join()) {
        throw new ConflictException({
          code: 'GRUPO_ALTERADO',
          message: 'O grupo mudou enquanto você validava. Tente de novo.',
        });
      }
    };
    const gravar = (
      tx: Parameters<DenunciaGrupoRepository['lerNaTransacao']>[0],
      transferido: number,
      partes: Array<{ alunoId: string; pontos: number }>,
    ) => {
      this.grupos.gravarNaTransacao(
        tx,
        new DenunciaGrupoEntity({
          ...g,
          status: 'VALIDADO',
          resolvidoEm: agora,
          pontos,
          pontosTransferidos: transferido,
        }),
      );
      denuncias.forEach((d, i) => {
        this.denuncias.gravarNaTransacao(tx, d.id, {
          status: 'VALIDADA',
          resolvidaEm: agora,
          pontos,
          pontosTransferidos: partes[i]?.pontos ?? 0,
          imagemPath: null as unknown as undefined,
        });
      });
    };

    let resultado: {
      transferido: number;
      partes: Array<{ alunoId: string; pontos: number }>;
    };
    if (turma.configPontuacao.pontuacaoAtiva && pontos > 0) {
      resultado = await this.xp.transferirParaVarios({
        turmaId,
        deAlunoId: g.denunciadoAlunoId,
        paraAlunoIds: autores,
        pontos,
        motivo: 'DENUNCIA',
        noMesmoCommit: { ler, gravar },
      });
    } else {
      const partes = autores.map((alunoId) => ({ alunoId, pontos: 0 }));
      await this.grupos.transacao(async (tx) => {
        await ler(tx);
        gravar(tx, 0, partes);
      });
      resultado = { transferido: 0, partes };
    }
    await this.apagarImagens(fotos);
    return {
      pontosTransferidos: resultado.transferido,
      partes: resultado.partes,
    };
  }

  /** Invalida o grupo inteiro (033 #7). Para invalidar só uma, desassocie antes. */
  async invalidarGrupo(
    professorId: string,
    turmaId: string,
    grupoId: string,
  ): Promise<void> {
    await this.turmaDoProfessor(professorId, turmaId);
    const g = await this.grupoDoProfessor(turmaId, grupoId);
    g.assertPendente();
    const fotos = this.fotosDeLegado(await this.denunciasDoGrupo(g));
    const agora = new Date().toISOString();
    await this.grupos.transacao(async (tx) => {
      const atual = await this.grupoNaTransacao(tx, turmaId, grupoId);
      atual.assertPendente();
      this.grupos.gravarNaTransacao(
        tx,
        new DenunciaGrupoEntity({
          ...atual,
          status: 'INVALIDADO',
          resolvidoEm: agora,
        }),
      );
      for (const id of atual.denunciaIds) {
        this.denuncias.gravarNaTransacao(tx, id, {
          status: 'INVALIDADA',
          resolvidaEm: agora,
          imagemPath: null as unknown as undefined,
        });
      }
    });
    await this.apagarImagens(fotos);
  }

  // ===== Janela de denúncia (033) =====

  /** Abre a janela; abrir já aberta devolve a atual (não cria outra). */
  async abrirJanela(
    professorId: string,
    turmaId: string,
  ): Promise<{ abertas: boolean; janela: DenunciaJanelaEntity }> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.denunciasAbertas === true && turma.denunciaJanelaId) {
      const atual = await this.janelaRepo.findById(turma.denunciaJanelaId);
      if (atual) return { abertas: true, janela: atual };
    }
    const janela = await this.janelaRepo.create({
      turmaId,
      professorId,
      abertaEm: new Date().toISOString(),
    });
    await this.turmaRepo.update(turmaId, {
      denunciasAbertas: true,
      denunciaJanelaId: janela.id,
    });
    return { abertas: true, janela };
  }

  /** Fecha a janela; fechar já fechada não muda nada. Pendentes seguem resolvíveis. */
  async fecharJanela(
    professorId: string,
    turmaId: string,
  ): Promise<{ abertas: boolean }> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.denunciasAbertas !== true) return { abertas: false };
    if (turma.denunciaJanelaId) {
      await this.janelaRepo.update(turma.denunciaJanelaId, {
        fechadaEm: new Date().toISOString(),
      });
    }
    await this.turmaRepo.update(turmaId, {
      denunciasAbertas: false,
      denunciaJanelaId: null,
    });
    return { abertas: false };
  }

  /** Estado atual + histórico de janelas, mais nova primeiro. */
  async janelas(
    professorId: string,
    turmaId: string,
  ): Promise<{
    abertas: boolean;
    janelaAtualId: string | null;
    janelas: DenunciaJanelaEntity[];
  }> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    const janelas = (await this.janelaRepo.findBy('turmaId', turmaId)).sort(
      (a, b) =>
        b.abertaEm.localeCompare(a.abertaEm) || b.id.localeCompare(a.id),
    );
    const abertas = turma.denunciasAbertas === true;
    return {
      abertas,
      janelaAtualId: abertas ? (turma.denunciaJanelaId ?? null) : null,
      janelas,
    };
  }

  /** `{ turmaId: pendentes }` para os badges da lista e do detalhe da turma. */
  async pendentesPorTurma(
    professorId: string,
  ): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {};
    for (const d of await this.denuncias.pendentesDoProfessor(professorId)) {
      contagem[d.turmaId] = (contagem[d.turmaId] ?? 0) + 1;
    }
    return contagem;
  }

  // ===== Apoio =====

  /** Mesmo gate do portal do aluno (recurso GAMIFICACAO, #1). */
  private async assertPlano(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message:
          'A denúncia faz parte do portal do aluno, exclusivo do plano PhD.',
      });
    }
  }

  private async topicosAtivos(
    professorId: string,
  ): Promise<DenunciaTopicoEntity[]> {
    return (await this.topicos.findBy('professorId', professorId))
      .filter((t) => t.ativo !== false)
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  }

  private async turmaDoAluno(turmaId: string) {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) throw new NotFoundException('Turma não encontrada.');
    await this.assertPlano(turma.professorId);
    return turma;
  }

  private async turmaDoProfessor(professorId: string, turmaId: string) {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma não encontrada.');
    }
    await this.assertPlano(professorId);
    return turma;
  }

  private async denunciaDoProfessor(
    professorId: string,
    turmaId: string,
    id: string,
    turmaJa?: unknown,
  ): Promise<DenunciaEntity> {
    if (!turmaJa) await this.turmaDoProfessor(professorId, turmaId);
    const d = await this.denuncias.findById(id);
    if (!d || d.turmaId !== turmaId) {
      throw new NotFoundException('Denúncia não encontrada.');
    }
    return d;
  }

  private async grupoDoProfessor(
    turmaId: string,
    grupoId: string,
  ): Promise<DenunciaGrupoEntity> {
    const g = await this.grupos.findById(grupoId);
    if (!g || g.turmaId !== turmaId) {
      throw new NotFoundException('Grupo não encontrado.');
    }
    return g;
  }

  /** As denúncias do grupo, na ordem do grupo (cronológica). */
  private async denunciasDoGrupo(
    g: DenunciaGrupoEntity,
  ): Promise<DenunciaEntity[]> {
    const lista: DenunciaEntity[] = [];
    for (const id of g.denunciaIds) {
      const d = await this.denuncias.findById(id);
      if (d) lista.push(d);
    }
    return lista;
  }

  /** Fotos de legado (anteriores à 033), lidas antes do commit que as zera. */
  private fotosDeLegado(denuncias: DenunciaEntity[]): string[] {
    return denuncias.flatMap((d) => (d.imagemPath ? [d.imagemPath] : []));
  }

  /** Apagadas depois do commit; falhar só gera log (o storage não lança). */
  private async apagarImagens(fotos: string[]): Promise<void> {
    for (const path of fotos) await this.imagens.apagar(path);
  }

  private async denunciaNaTransacao(
    tx: Parameters<DenunciaRepository['lerNaTransacao']>[0],
    turmaId: string,
    id: string,
  ): Promise<DenunciaEntity> {
    const d = await this.denuncias.lerNaTransacao(tx, id);
    if (!d || d.turmaId !== turmaId) {
      throw new NotFoundException('Denúncia não encontrada.');
    }
    return d;
  }

  private async grupoNaTransacao(
    tx: Parameters<DenunciaGrupoRepository['lerNaTransacao']>[0],
    turmaId: string,
    id: string,
  ): Promise<DenunciaGrupoEntity> {
    const g = await this.grupos.lerNaTransacao(tx, id);
    if (!g || g.turmaId !== turmaId) {
      throw new NotFoundException('Grupo não encontrado.');
    }
    return g;
  }

  private async nomesDaTurma(turmaId: string) {
    return new Map(
      (await this.alunoRepo.findByTurma(turmaId)).map((a) => [a.id, a]),
    );
  }

  private maisNovas(lista: DenunciaEntity[]): DenunciaEntity[] {
    return [...lista].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  }
}
