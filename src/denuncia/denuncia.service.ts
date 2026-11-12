import {
  BadRequestException,
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
  topicoId?: string;
  topicoTitulo?: string;
  /** Pontos sugeridos do tópico, se ele ainda existir. */
  pontosSugeridos?: number;
  texto?: string;
  temImagem: boolean;
  pontos?: number;
  pontosTransferidos?: number;
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
            (await this.denuncias.lerNaTransacao(tx, id)).assertPendente();
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
    const imagem = d.imagemPath;
    await this.denuncias.resolverSePendente(id, {
      status: 'INVALIDADA',
      resolvidaEm: new Date().toISOString(),
      imagemPath: null as unknown as undefined,
    });
    if (imagem) await this.imagens.apagar(imagem);
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

  private async nomesDaTurma(turmaId: string) {
    return new Map(
      (await this.alunoRepo.findByTurma(turmaId)).map((a) => [a.id, a]),
    );
  }

  private maisNovas(lista: DenunciaEntity[]): DenunciaEntity[] {
    return [...lista].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
  }
}
