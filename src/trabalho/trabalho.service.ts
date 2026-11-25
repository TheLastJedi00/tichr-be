import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { contentTypeDe, ExtensaoAnexo, validarAnexo } from '../common/anexo';
import { AnexoStorage } from '../common/anexo.storage';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { XpService } from '../turma/xp.service';
import { AtividadeRepository } from './atividade.repository';
import { AtividadeEntity, DadosAtividade } from './entities/atividade.entity';
import {
  ArquivoEntrega,
  EntregaEntity,
  EstadoEntrega,
  estadoDaEntrega,
} from './entities/entrega.entity';
import { EntregaRepository } from './entrega.repository';

type Aluno = { alunoId: string; turmaId: string };
/** Arquivo multipart do aluno (nome já em UTF-8, ver o controller). */
export type ArquivoEnviado = { originalname: string; buffer: Buffer };

/** O que o aluno vê da atividade. */
export interface AtividadeView {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string;
  valorPontos: number;
  aberta: boolean;
}

/** O professor vê também os contadores da turma. */
export interface AtividadeProfessorView extends AtividadeView {
  totalEntregas: number;
  aguardandoAvaliacao: number;
  totalAlunos: number;
  criadaEm: string;
}

/** A entrega como o aluno e o professor a veem: sem o `path` dos arquivos. */
export interface EntregaView {
  estado: EstadoEntrega;
  texto: string | null;
  arquivos: Array<{
    id: string;
    nome: string;
    extensao: ExtensaoAnexo;
    tamanho: number;
    enviadoEm: string;
  }>;
  criadaEm: string | null;
  atualizadaEm: string | null;
  avaliacao: {
    nota: number;
    comentario: string | null;
    avaliadaEm: string;
    /** XP que de fato entrou no ranking por este trabalho. */
    pontos: number;
  } | null;
}

export interface TrabalhoDoAlunoView {
  atividade: AtividadeView;
  estado: EstadoEntrega;
  nota: number | null;
  atualizadaEm: string | null;
}

/** Uma linha da lista de entregas do professor (todos os alunos da turma). */
export interface EntregaResumoView {
  alunoId: string;
  alunoNome: string;
  estado: EstadoEntrega;
  atualizadaEm: string | null;
  nota: number | null;
  temTexto: boolean;
  totalArquivos: number;
}

export interface EntregasDaAtividadeView {
  atividade: AtividadeProfessorView;
  alunos: EntregaResumoView[];
}

export interface EntregaDoAlunoView {
  atividade: AtividadeProfessorView;
  aluno: { id: string; nome: string };
  estado: EstadoEntrega;
  entrega: EntregaView | null;
}

export interface DetalheDoAlunoView {
  atividade: AtividadeView;
  estado: EstadoEntrega;
  entrega: EntregaView | null;
}

/** Pendentes primeiro (prazo mais próximo), depois entregues, avaliadas, perdidas. */
const ORDEM_ALUNO: Record<EstadoEntrega, number> = {
  PENDENTE: 0,
  ENTREGUE: 1,
  AVALIADA: 2,
  PERDIDA: 3,
};

/** Para avaliar primeiro, depois avaliadas, pendentes e quem não entregou. */
const ORDEM_PROFESSOR: Record<EstadoEntrega, number> = {
  ENTREGUE: 0,
  AVALIADA: 1,
  PENDENTE: 2,
  PERDIDA: 3,
};

/**
 * Envio de trabalhos (spec 038): o professor cria a atividade, o aluno entrega
 * texto e/ou arquivos até o prazo e o professor avalia; a nota vira XP.
 */
@Injectable()
export class TrabalhoService {
  constructor(
    private readonly atividades: AtividadeRepository,
    private readonly entregas: EntregaRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly xp: XpService,
    private readonly arquivos: AnexoStorage,
  ) {}

  // ===== Professor: atividades (#1–#5) =====

  /** `{ turmaId: n }` de entregas esperando nota (badge da aba). */
  async pendentesPorTurma(
    professorId: string,
  ): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {};
    for (const a of await this.atividades.doProfessor(professorId)) {
      if (!a.aguardandoAvaliacao) continue;
      contagem[a.turmaId] = (contagem[a.turmaId] ?? 0) + a.aguardandoAvaliacao;
    }
    return contagem;
  }

  async listarAtividades(
    professorId: string,
    turmaId: string,
  ): Promise<AtividadeProfessorView[]> {
    await this.turmaDoProfessor(professorId, turmaId);
    const totalAlunos = await this.totalAlunos(turmaId);
    return (await this.atividades.daTurma(turmaId)).map((a) =>
      this.viewProfessor(a, totalAlunos),
    );
  }

  async criarAtividade(
    professorId: string,
    turmaId: string,
    dados: DadosAtividade,
  ): Promise<AtividadeProfessorView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const nova = AtividadeEntity.criar({ ...dados, turmaId, professorId });
    const criada = await this.atividades.create(nova);
    return this.viewProfessor(criada, await this.totalAlunos(turmaId));
  }

  /** Em transação: uma entrega chegando no meio não perde o contador. */
  async editarAtividade(
    professorId: string,
    turmaId: string,
    id: string,
    dados: DadosAtividade,
  ): Promise<AtividadeProfessorView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const editada = await this.atividades.transacao(async (tx) => {
      const a = await this.atividades.lerNaTransacao(tx, id);
      if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
      a.editar(dados);
      this.atividades.gravarNaTransacao(tx, a);
      return a;
    });
    return this.viewProfessor(editada, await this.totalAlunos(turmaId));
  }

  /** Só sem entregas (#5); relido na transação contra uma entrega simultânea. */
  async excluirAtividade(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<void> {
    await this.turmaDoProfessor(professorId, turmaId);
    await this.atividades.transacao(async (tx) => {
      const a = await this.atividades.lerNaTransacao(tx, id);
      if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
      a.garantirExcluivel();
      this.atividades.excluirNaTransacao(tx, id);
    });
  }

  // ===== Professor: entregas e avaliação (#14–#19) =====

  async entregasDaAtividade(
    professorId: string,
    turmaId: string,
    atividadeId: string,
  ): Promise<EntregasDaAtividadeView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const a = await this.atividadeDaTurma(turmaId, atividadeId);
    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const porAluno = new Map(
      (await this.entregas.daAtividade(a.id)).map((e) => [e.alunoId, e]),
    );
    const agora = new Date();
    const linha = (
      alunoId: string,
      alunoNome: string,
      e: EntregaEntity | undefined,
    ): EntregaResumoView => ({
      alunoId,
      alunoNome,
      estado: estadoDaEntrega(a, e, agora),
      atualizadaEm: e?.entregue ? e.atualizadaEm : null,
      nota: e?.avaliacao?.nota ?? null,
      temTexto: !!e?.texto?.trim(),
      totalArquivos: e?.arquivos.length ?? 0,
    });
    const linhas = alunos.map((al) =>
      linha(al.id, al.nome, porAluno.get(al.id)),
    );
    // Quem saiu da turma mas entregou continua aparecendo.
    const naTurma = new Set(alunos.map((al) => al.id));
    for (const e of porAluno.values()) {
      if (!naTurma.has(e.alunoId) && e.entregue) {
        linhas.push(linha(e.alunoId, 'Aluno removido', e));
      }
    }
    linhas.sort(
      (x, y) =>
        ORDEM_PROFESSOR[x.estado] - ORDEM_PROFESSOR[y.estado] ||
        x.alunoNome.localeCompare(y.alunoNome, 'pt-BR'),
    );
    return { atividade: this.viewProfessor(a, alunos.length), alunos: linhas };
  }

  async entregaDoAluno(
    professorId: string,
    turmaId: string,
    atividadeId: string,
    alunoId: string,
  ): Promise<EntregaDoAlunoView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const a = await this.atividadeDaTurma(turmaId, atividadeId);
    const aluno = await this.alunoDaTurma(turmaId, alunoId);
    const e = await this.entregas.findById(EntregaEntity.idDe(a.id, alunoId));
    const agora = new Date();
    return {
      atividade: this.viewProfessor(a, await this.totalAlunos(turmaId)),
      aluno: { id: aluno.id, nome: aluno.nome },
      estado: estadoDaEntrega(a, e, agora),
      entrega: e ? this.viewEntrega(a, e, agora) : null,
    };
  }

  async arquivoDoProfessor(
    professorId: string,
    turmaId: string,
    atividadeId: string,
    alunoId: string,
    arquivoId: string,
  ): Promise<{ url: string }> {
    await this.turmaDoProfessor(professorId, turmaId);
    const a = await this.atividadeDaTurma(turmaId, atividadeId);
    return this.urlDoArquivo(a.id, alunoId, arquivoId);
  }

  /**
   * Nota + comentário (#14) e o XP na mesma transação (#15): relê atividade
   * e entrega, credita a diferença do já creditado (#16) e tira a entrega do
   * "para avaliar". Vale depois do prazo; trava a edição do aluno (#10).
   */
  async avaliar(
    professorId: string,
    turmaId: string,
    atividadeId: string,
    alunoId: string,
    dto: { nota: number; comentario?: string | null },
  ): Promise<EntregaView> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    await this.atividadeDaTurma(turmaId, atividadeId);
    await this.alunoDaTurma(turmaId, alunoId);
    const pontuacaoAtiva = turma.configPontuacao.pontuacaoAtiva;
    const agora = new Date();
    const { contexto } = await this.xp.ajustarNoMesmoCommit({
      turmaId,
      alunoId,
      motivo: 'TRABALHO',
      ler: async (tx) => {
        const a = await this.atividades.lerNaTransacao(tx, atividadeId);
        if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
        const e = await this.entregas.lerNaTransacao(
          tx,
          EntregaEntity.idDe(a.id, alunoId),
        );
        if (!e || !e.entregue) {
          throw new NotFoundException({
            code: 'ENTREGA_NAO_ENCONTRADA',
            message: 'Este aluno ainda não entregou o trabalho.',
          });
        }
        const antes = { entregue: e.entregue, avaliada: e.avaliada };
        const pontos = e.avaliar(
          dto,
          { valorPontos: a.valorPontos, pontuacaoAtiva },
          agora,
        );
        return { pontos, contexto: { a, e, antes } };
      },
      gravar: (tx, aplicado, { a, e, antes }) => {
        e.registrarCredito(aplicado);
        a.contarEntrega(antes, { entregue: e.entregue, avaliada: e.avaliada });
        this.entregas.gravarNaTransacao(tx, e);
        this.atividades.gravarNaTransacao(tx, a);
      },
    });
    return this.viewEntrega(contexto.a, contexto.e, agora);
  }

  // ===== Aluno (#6–#13) =====

  async listarDoAluno(aluno: Aluno): Promise<TrabalhoDoAlunoView[]> {
    await this.turmaDoAluno(aluno.turmaId);
    const agora = new Date();
    const minhas = new Map(
      (await this.entregas.doAluno(aluno.alunoId, aluno.turmaId)).map((e) => [
        e.atividadeId,
        e,
      ]),
    );
    return (await this.atividades.daTurma(aluno.turmaId))
      .map((a) => {
        const e = minhas.get(a.id);
        return {
          atividade: this.view(a, agora),
          estado: estadoDaEntrega(a, e, agora),
          nota: e?.avaliacao?.nota ?? null,
          atualizadaEm: e?.entregue ? e.atualizadaEm : null,
        };
      })
      .sort(
        (x, y) =>
          ORDEM_ALUNO[x.estado] - ORDEM_ALUNO[y.estado] ||
          x.atividade.prazo.localeCompare(y.atividade.prazo),
      );
  }

  async detalheDoAluno(
    aluno: Aluno,
    atividadeId: string,
  ): Promise<DetalheDoAlunoView> {
    await this.turmaDoAluno(aluno.turmaId);
    const a = await this.atividadeDaTurma(aluno.turmaId, atividadeId);
    const e = await this.entregas.findById(
      EntregaEntity.idDe(a.id, aluno.alunoId),
    );
    const agora = new Date();
    return {
      atividade: this.view(a, agora),
      estado: estadoDaEntrega(a, e, agora),
      entrega: e ? this.viewEntrega(a, e, agora) : null,
    };
  }

  async salvarTexto(
    aluno: Aluno,
    atividadeId: string,
    texto: string,
  ): Promise<EntregaView> {
    await this.turmaDoAluno(aluno.turmaId);
    return this.mudarEntrega(aluno, atividadeId, (e) => e.definirTexto(texto));
  }

  /**
   * Um arquivo por requisição (#9). Confere prazo, avaliação, tipo e limite
   * antes de subir; sobe ANTES da transação (como a 037): se ela recusar,
   * apagar o arquivo desfaz tudo. Nenhuma entrega aponta para arquivo
   * inexistente.
   */
  async enviarArquivo(
    aluno: Aluno,
    atividadeId: string,
    arquivo: ArquivoEnviado | undefined,
  ): Promise<EntregaView> {
    await this.turmaDoAluno(aluno.turmaId);
    const a = await this.atividadeDaTurma(aluno.turmaId, atividadeId);
    const atual =
      (await this.entregas.findById(EntregaEntity.idDe(a.id, aluno.alunoId))) ??
      EntregaEntity.nova({ atividadeId: a.id, ...aluno });
    atual.garantirEditavel(a);
    if (!arquivo) {
      throw new BadRequestException({
        code: 'ARQUIVO_AUSENTE',
        message: 'Escolha um arquivo para enviar.',
      });
    }
    const v = validarAnexo(arquivo.originalname, arquivo.buffer);
    const id = this.entregas.novoArquivoId();
    const novo: ArquivoEntrega = {
      id,
      path: `trabalhos/${aluno.turmaId}/${a.id}/${aluno.alunoId}/${id}`,
      nome: v.nome,
      extensao: v.extensao,
      tamanho: v.tamanho,
      enviadoEm: new Date().toISOString(),
    };
    // Limite de arquivos conferido numa cópia, antes do upload.
    new EntregaEntity({
      ...atual,
      arquivos: [...atual.arquivos],
    }).adicionarArquivo(novo);
    try {
      await this.arquivos.salvar(novo.path, arquivo.buffer, v.contentType);
    } catch {
      throw new BadGatewayException({
        code: 'ANEXO_FALHOU',
        message: 'Não deu para enviar o arquivo. Tente de novo.',
      });
    }
    try {
      return await this.mudarEntrega(aluno, atividadeId, (e) =>
        e.adicionarArquivo(novo),
      );
    } catch (erro) {
      await this.arquivos.apagar(novo.path);
      throw erro;
    }
  }

  /** Sai da entrega na transação e depois do Storage (#22). */
  async removerArquivo(
    aluno: Aluno,
    atividadeId: string,
    arquivoId: string,
  ): Promise<EntregaView> {
    await this.turmaDoAluno(aluno.turmaId);
    let removido: ArquivoEntrega | undefined;
    const view = await this.mudarEntrega(aluno, atividadeId, (e) => {
      removido = e.removerArquivo(arquivoId);
    });
    if (removido) await this.arquivos.apagar(removido.path);
    return view;
  }

  /** O aluno baixa o que ele mesmo enviou, mesmo depois do prazo. */
  async arquivoDoAluno(
    aluno: Aluno,
    atividadeId: string,
    arquivoId: string,
  ): Promise<{ url: string }> {
    await this.turmaDoAluno(aluno.turmaId);
    const a = await this.atividadeDaTurma(aluno.turmaId, atividadeId);
    return this.urlDoArquivo(a.id, aluno.alunoId, arquivoId);
  }

  /**
   * Muda a entrega do aluno e os contadores da atividade numa transação só:
   * relê os dois, confere prazo e avaliação (#10) e grava junto. Dois envios
   * simultâneos caem no mesmo doc (#6) e não contam em dobro.
   */
  private async mudarEntrega(
    aluno: Aluno,
    atividadeId: string,
    mudar: (e: EntregaEntity) => void,
  ): Promise<EntregaView> {
    const agora = new Date();
    const { a, e } = await this.atividades.transacao(async (tx) => {
      const a = await this.atividades.lerNaTransacao(tx, atividadeId);
      if (!a || a.turmaId !== aluno.turmaId) {
        throw this.atividadeNaoEncontrada();
      }
      const id = EntregaEntity.idDe(a.id, aluno.alunoId);
      const existente = await this.entregas.lerNaTransacao(tx, id);
      const e =
        existente ?? EntregaEntity.nova({ atividadeId: a.id, ...aluno }, agora);
      const antes = { entregue: e.entregue, avaliada: e.avaliada };
      e.garantirEditavel(a, agora);
      mudar(e);
      a.contarEntrega(antes, { entregue: e.entregue, avaliada: e.avaliada });
      if (existente || e.entregue) this.entregas.gravarNaTransacao(tx, e);
      this.atividades.gravarNaTransacao(tx, a);
      return { a, e };
    });
    return this.viewEntrega(a, e, agora);
  }

  private async urlDoArquivo(
    atividadeId: string,
    alunoId: string,
    arquivoId: string,
  ): Promise<{ url: string }> {
    const e = await this.entregas.findById(
      EntregaEntity.idDe(atividadeId, alunoId),
    );
    if (!e) {
      throw new NotFoundException({
        code: 'ARQUIVO_NAO_ENCONTRADO',
        message: 'Arquivo não encontrado.',
      });
    }
    const arq = e.arquivo(arquivoId);
    const url = await this.arquivos.urlAssinada(
      arq.path,
      arq.nome,
      contentTypeDe(arq.extensao),
    );
    return { url };
  }

  // ===== Views =====

  private view(a: AtividadeEntity, agora = new Date()): AtividadeView {
    return {
      id: a.id,
      titulo: a.titulo,
      descricao: a.descricao ?? null,
      prazo: a.prazo,
      valorPontos: a.valorPontos,
      aberta: a.aberta(agora),
    };
  }

  private viewProfessor(
    a: AtividadeEntity,
    totalAlunos: number,
  ): AtividadeProfessorView {
    return {
      ...this.view(a),
      totalEntregas: a.totalEntregas ?? 0,
      aguardandoAvaliacao: a.aguardandoAvaliacao ?? 0,
      totalAlunos,
      criadaEm: a.criadaEm,
    };
  }

  private viewEntrega(
    a: AtividadeEntity,
    e: EntregaEntity,
    agora = new Date(),
  ): EntregaView {
    return {
      estado: estadoDaEntrega(a, e, agora),
      texto: e.texto ?? null,
      arquivos: e.arquivos.map((x) => ({
        id: x.id,
        nome: x.nome,
        extensao: x.extensao,
        tamanho: x.tamanho,
        enviadoEm: x.enviadoEm,
      })),
      criadaEm: e.criadaEm ?? null,
      atualizadaEm: e.atualizadaEm ?? null,
      avaliacao: e.avaliacao
        ? {
            nota: e.avaliacao.nota,
            comentario: e.avaliacao.comentario ?? null,
            avaliadaEm: e.avaliacao.avaliadaEm,
            pontos: e.avaliacao.xpCreditado,
          }
        : null,
    };
  }

  // ===== Apoio =====

  private atividadeNaoEncontrada(): NotFoundException {
    return new NotFoundException({
      code: 'ATIVIDADE_NAO_ENCONTRADA',
      message: 'Trabalho não encontrado.',
    });
  }

  /** Atividade de outra turma é 404: nem a existência vaza (#20). */
  private async atividadeDaTurma(
    turmaId: string,
    id: string,
  ): Promise<AtividadeEntity> {
    const a = await this.atividades.findById(id);
    if (!a || a.turmaId !== turmaId) throw this.atividadeNaoEncontrada();
    return a;
  }

  private async alunoDaTurma(turmaId: string, alunoId: string) {
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    return aluno;
  }

  private async totalAlunos(turmaId: string): Promise<number> {
    return (await this.alunoRepo.findByTurma(turmaId)).length;
  }

  /** Mesmo gate do portal do aluno (recurso GAMIFICACAO, #23). */
  private async assertPlano(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message:
          'O envio de trabalhos faz parte do portal do aluno, exclusivo do plano PhD.',
      });
    }
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
}
