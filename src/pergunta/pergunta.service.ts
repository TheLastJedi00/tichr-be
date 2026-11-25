import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from '../turma/repositories/aluno.repository';
import { TurmaRepository } from '../turma/repositories/turma.repository';
import { contentTypeDe, ExtensaoAnexo, validarAnexo } from '../common/anexo';
import {
  AnexoMensagem,
  PerguntaMensagemEntity,
} from './entities/pergunta-mensagem.entity';
import {
  Aguardando,
  AutorMensagem,
  PerguntaEntity,
  StatusPergunta,
} from './entities/pergunta.entity';
import { AnexoStorage } from '../common/anexo.storage';
import { PerguntaMensagemRepository } from './pergunta-mensagem.repository';
import { PerguntaRepository } from './pergunta.repository';

type Aluno = { alunoId: string; turmaId: string };
/** Arquivo multipart do aluno (nome já em UTF-8, ver o controller). */
export type ArquivoEnviado = { originalname: string; buffer: Buffer };
type AnexoPreparado = {
  dados: AnexoMensagem;
  buffer: Buffer;
  contentType: string;
};

export interface EstadoJanelaPerguntas {
  abertas: boolean;
  desde: string | null;
}

/** O que o aluno autor vê da própria pergunta. */
export interface PerguntaView {
  id: string;
  titulo: string;
  status: StatusPergunta;
  aguardando: Aguardando | null;
  criadaEm: string;
  atualizadaEm: string;
  totalMensagens: number;
  temAnexo: boolean;
  encerradaEm?: string;
  encerradaPor?: AutorMensagem;
}

/** O professor vê também quem perguntou (#10: não é anônima). */
export interface PerguntaProfessorView extends PerguntaView {
  alunoId: string;
  alunoNome: string;
}

export interface MensagemView {
  id: string;
  autor: AutorMensagem;
  texto?: string;
  anexo?: { nome: string; extensao: ExtensaoAnexo; tamanho: number };
  criadaEm: string;
}

export interface DetalheView<V extends PerguntaView = PerguntaView> {
  pergunta: V;
  mensagens: MensagemView[];
}

/**
 * Perguntas do aluno ao professor (spec 037): conversa privada entre o aluno
 * autor e o professor dono da turma, com anexo opcional do aluno.
 */
@Injectable()
export class PerguntaService {
  constructor(
    private readonly perguntas: PerguntaRepository,
    private readonly mensagens: PerguntaMensagemRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly anexos: AnexoStorage,
  ) {}

  // ===== Janela de perguntas (#1–#3) =====

  async estadoJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    return this.estado(turma);
  }

  /** Abrir já aberta mantém o "desde" original. */
  async abrirJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.perguntasAbertas === true) return this.estado(turma);
    const desde = new Date().toISOString();
    await this.turmaRepo.update(turmaId, {
      perguntasAbertas: true,
      perguntasAbertasDesde: desde,
    });
    return { abertas: true, desde };
  }

  /** Fechar não mexe nas perguntas: o professor segue respondendo (#3). */
  async fecharJanela(
    professorId: string,
    turmaId: string,
  ): Promise<EstadoJanelaPerguntas> {
    const turma = await this.turmaDoProfessor(professorId, turmaId);
    if (turma.perguntasAbertas === true) {
      await this.turmaRepo.update(turmaId, {
        perguntasAbertas: false,
        perguntasAbertasDesde: null,
      });
    }
    return { abertas: false, desde: null };
  }

  // ===== Aluno =====

  async estadoAluno({ turmaId }: Aluno): Promise<{ abertas: boolean }> {
    const turma = await this.turmaDoAluno(turmaId);
    return { abertas: turma.perguntasAbertas === true };
  }

  async minhasDoAluno({ alunoId, turmaId }: Aluno): Promise<PerguntaView[]> {
    await this.turmaDoAluno(turmaId);
    const minhas = (await this.perguntas.findBy('alunoId', alunoId)).filter(
      (p) => p.turmaId === turmaId,
    );
    return this.ordenar(minhas).map((p) => this.view(p));
  }

  async detalheDoAluno(aluno: Aluno, id: string): Promise<DetalheView> {
    await this.turmaDoAluno(aluno.turmaId);
    const p = await this.perguntaDoAluno(aluno, id);
    return this.detalhe(p, this.view(p));
  }

  async criarDoAluno(
    { alunoId, turmaId }: Aluno,
    dto: { titulo: string; texto?: string },
    arquivo?: ArquivoEnviado,
  ): Promise<{ id: string }> {
    const turma = await this.turmaDoAluno(turmaId);
    this.assertJanelaAberta(turma);
    const abertas = (await this.perguntas.findBy('alunoId', alunoId)).filter(
      (p) => p.turmaId === turmaId && p.status === 'ABERTA',
    ).length;
    const pergunta = PerguntaEntity.criar(
      { turmaId, professorId: turma.professorId, alunoId, titulo: dto.titulo },
      abertas,
    );
    pergunta.id = this.perguntas.novoId();
    const mensagemId = this.mensagens.novoId();
    const anexo = this.prepararAnexo(arquivo, turmaId, pergunta.id, mensagemId);
    const primeira = PerguntaMensagemEntity.criar(
      {
        perguntaId: pergunta.id,
        turmaId,
        autor: 'ALUNO',
        texto: dto.texto,
        anexo: anexo?.dados,
      },
      new Date(pergunta.criadaEm),
    );
    primeira.id = mensagemId;
    if (anexo) pergunta.temAnexo = true;
    await this.comAnexo(anexo, () =>
      this.perguntas.transacao(async (tx) => {
        this.perguntas.gravarNaTransacao(tx, pergunta);
        this.mensagens.gravarNaTransacao(tx, primeira);
        return Promise.resolve();
      }),
    );
    return { id: pergunta.id };
  }

  async responderDoAluno(
    aluno: Aluno,
    id: string,
    dto: { texto?: string },
    arquivo?: ArquivoEnviado,
  ): Promise<MensagemView> {
    const turma = await this.turmaDoAluno(aluno.turmaId);
    const p = await this.perguntaDoAluno(aluno, id);
    this.assertJanelaAberta(turma);
    return this.enviar(p, 'ALUNO', dto.texto, arquivo);
  }

  /** O aluno baixa o que ele mesmo enviou, mesmo com a janela fechada. */
  async anexoDoAluno(
    aluno: Aluno,
    id: string,
    mensagemId: string,
  ): Promise<{ url: string }> {
    await this.turmaDoAluno(aluno.turmaId);
    const p = await this.perguntaDoAluno(aluno, id);
    return this.urlDoAnexo(p, mensagemId);
  }

  /** O autor encerra mesmo com a janela fechada (#3, #5). */
  async encerrarDoAluno(aluno: Aluno, id: string): Promise<PerguntaView> {
    await this.turmaDoAluno(aluno.turmaId);
    const p = await this.perguntaDoAluno(aluno, id);
    return this.view(await this.mudarStatus(p.id, (q) => q.encerrar('ALUNO')));
  }

  // ===== Professor =====

  /** `{ turmaId: n }` de perguntas esperando o professor (badge da aba). */
  async pendentesPorTurma(
    professorId: string,
  ): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {};
    for (const p of await this.perguntas.abertasDoProfessor(professorId)) {
      if (p.aguardando !== 'AGUARDANDO_PROFESSOR') continue;
      contagem[p.turmaId] = (contagem[p.turmaId] ?? 0) + 1;
    }
    return contagem;
  }

  async listarDaTurma(
    professorId: string,
    turmaId: string,
    status?: StatusPergunta,
  ): Promise<PerguntaProfessorView[]> {
    await this.turmaDoProfessor(professorId, turmaId);
    const todas = (await this.perguntas.findBy('turmaId', turmaId)).filter(
      (p) => !status || p.status === status,
    );
    const nomes = await this.nomesDaTurma(turmaId);
    return this.ordenar(todas).map((p) => this.viewProfessor(p, nomes));
  }

  async detalheDoProfessor(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<DetalheView<PerguntaProfessorView>> {
    await this.turmaDoProfessor(professorId, turmaId);
    const p = await this.perguntaDaTurma(turmaId, id);
    const nomes = await this.nomesDaTurma(turmaId);
    return this.detalhe(p, this.viewProfessor(p, nomes));
  }

  /** O professor responde mesmo com a janela fechada (#3), só texto (#12). */
  async responderDoProfessor(
    professorId: string,
    turmaId: string,
    id: string,
    dto: { texto: string },
  ): Promise<MensagemView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const p = await this.perguntaDaTurma(turmaId, id);
    return this.enviar(p, 'PROFESSOR', dto.texto);
  }

  async encerrarDoProfessor(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<PerguntaView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const p = await this.perguntaDaTurma(turmaId, id);
    return this.view(
      await this.mudarStatus(p.id, (q) => q.encerrar('PROFESSOR')),
    );
  }

  async anexoDoProfessor(
    professorId: string,
    turmaId: string,
    id: string,
    mensagemId: string,
  ): Promise<{ url: string }> {
    await this.turmaDoProfessor(professorId, turmaId);
    const p = await this.perguntaDaTurma(turmaId, id);
    return this.urlDoAnexo(p, mensagemId);
  }

  /** Só o professor reabre (#5), sem depender da janela. */
  async reabrir(
    professorId: string,
    turmaId: string,
    id: string,
  ): Promise<PerguntaView> {
    await this.turmaDoProfessor(professorId, turmaId);
    const p = await this.perguntaDaTurma(turmaId, id);
    return this.view(await this.mudarStatus(p.id, (q) => q.reabrir()));
  }

  // ===== Conversa =====

  /**
   * Grava uma mensagem e atualiza a pergunta na mesma transação: duas
   * mensagens simultâneas não furam o limite nem uma encerrada.
   */
  private async enviar(
    p: PerguntaEntity,
    autor: AutorMensagem,
    texto: string | undefined,
    arquivo?: ArquivoEnviado,
  ): Promise<MensagemView> {
    // Falha cedo (encerrada/limite/arquivo) antes de subir ou gravar algo.
    new PerguntaEntity({ ...p }).registrarMensagem(autor);
    const mensagemId = this.mensagens.novoId();
    const anexo = this.prepararAnexo(arquivo, p.turmaId, p.id, mensagemId);
    const msg = PerguntaMensagemEntity.criar({
      perguntaId: p.id,
      turmaId: p.turmaId,
      autor,
      texto,
      anexo: anexo?.dados,
    });
    msg.id = mensagemId;
    await this.comAnexo(anexo, () =>
      this.perguntas.transacao(async (tx) => {
        const atual = await this.perguntas.lerNaTransacao(tx, p.id);
        if (!atual) throw new NotFoundException('Pergunta não encontrada.');
        atual.registrarMensagem(autor, new Date(msg.criadaEm));
        if (msg.anexo) atual.temAnexo = true;
        this.perguntas.gravarNaTransacao(tx, atual);
        this.mensagens.gravarNaTransacao(tx, msg);
      }),
    );
    return this.viewMensagem(msg);
  }

  /** Valida o arquivo e define o caminho privado (turma/pergunta/mensagem). */
  private prepararAnexo(
    arquivo: ArquivoEnviado | undefined,
    turmaId: string,
    perguntaId: string,
    mensagemId: string,
  ): AnexoPreparado | undefined {
    if (!arquivo) return undefined;
    const v = validarAnexo(arquivo.originalname, arquivo.buffer);
    return {
      dados: {
        path: `perguntas/${turmaId}/${perguntaId}/${mensagemId}`,
        nome: v.nome,
        extensao: v.extensao,
        tamanho: v.tamanho,
      },
      buffer: arquivo.buffer,
      contentType: v.contentType,
    };
  }

  /**
   * Sobe o anexo ANTES de gravar (ajuste da §3 na execução): se a transação
   * recusar, apagar o arquivo desfaz tudo; o contrário exigiria reverter os
   * contadores da pergunta. Nenhuma mensagem aponta para arquivo inexistente.
   */
  private async comAnexo(
    anexo: AnexoPreparado | undefined,
    gravar: () => Promise<unknown>,
  ): Promise<void> {
    if (anexo) {
      try {
        await this.anexos.salvar(
          anexo.dados.path,
          anexo.buffer,
          anexo.contentType,
        );
      } catch {
        throw new BadGatewayException({
          code: 'ANEXO_FALHOU',
          message: 'Não deu para enviar o arquivo. Tente de novo.',
        });
      }
    }
    try {
      await gravar();
    } catch (e) {
      if (anexo) await this.anexos.apagar(anexo.dados.path);
      throw e;
    }
  }

  /** URL assinada do anexo de uma mensagem desta pergunta. */
  private async urlDoAnexo(
    p: PerguntaEntity,
    mensagemId: string,
  ): Promise<{ url: string }> {
    const m = await this.mensagens.findById(mensagemId);
    if (!m || m.perguntaId !== p.id || !m.anexo) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    const url = await this.anexos.urlAssinada(
      m.anexo.path,
      m.anexo.nome,
      contentTypeDe(m.anexo.extensao),
    );
    return { url };
  }

  private async mudarStatus(
    id: string,
    mudar: (p: PerguntaEntity) => void,
  ): Promise<PerguntaEntity> {
    return this.perguntas.transacao(async (tx) => {
      const atual = await this.perguntas.lerNaTransacao(tx, id);
      if (!atual) throw new NotFoundException('Pergunta não encontrada.');
      mudar(atual);
      this.perguntas.gravarNaTransacao(tx, atual);
      return atual;
    });
  }

  private async detalhe<V extends PerguntaView>(
    p: PerguntaEntity,
    pergunta: V,
  ): Promise<DetalheView<V>> {
    const mensagens = (await this.mensagens.daPergunta(p.id)).map((m) =>
      this.viewMensagem(m),
    );
    return { pergunta, mensagens };
  }

  // ===== Views =====

  private view(p: PerguntaEntity): PerguntaView {
    const v: PerguntaView = {
      id: p.id,
      titulo: p.titulo,
      status: p.status,
      aguardando: p.aguardando,
      criadaEm: p.criadaEm,
      atualizadaEm: p.atualizadaEm,
      totalMensagens: p.totalMensagens,
      temAnexo: p.temAnexo === true,
    };
    if (p.encerradaEm) v.encerradaEm = p.encerradaEm;
    if (p.encerradaPor) v.encerradaPor = p.encerradaPor;
    return v;
  }

  private viewProfessor(
    p: PerguntaEntity,
    nomes: Map<string, { nome: string }>,
  ): PerguntaProfessorView {
    return {
      ...this.view(p),
      alunoId: p.alunoId,
      alunoNome: nomes.get(p.alunoId)?.nome ?? 'Aluno removido',
    };
  }

  /** Sem o `path` do anexo: o download passa pela URL assinada. */
  private viewMensagem(m: PerguntaMensagemEntity): MensagemView {
    const v: MensagemView = { id: m.id, autor: m.autor, criadaEm: m.criadaEm };
    if (m.texto) v.texto = m.texto;
    if (m.anexo) {
      v.anexo = {
        nome: m.anexo.nome,
        extensao: m.anexo.extensao,
        tamanho: m.anexo.tamanho,
      };
    }
    return v;
  }

  /** Esperando o professor primeiro; dentro de cada grupo, mais recente primeiro. */
  private ordenar(lista: PerguntaEntity[]): PerguntaEntity[] {
    const peso = (p: PerguntaEntity) =>
      p.aguardando === 'AGUARDANDO_PROFESSOR'
        ? 0
        : p.aguardando === 'AGUARDANDO_ALUNO'
          ? 1
          : 2;
    return [...lista].sort(
      (a, b) =>
        peso(a) - peso(b) || b.atualizadaEm.localeCompare(a.atualizadaEm),
    );
  }

  // ===== Apoio =====

  private assertJanelaAberta(turma: { perguntasAbertas?: boolean }): void {
    if (turma.perguntasAbertas !== true) {
      throw new ForbiddenException({
        code: 'PERGUNTAS_FECHADAS',
        message:
          'As perguntas estão fechadas. O professor abre durante a aula.',
      });
    }
  }

  private async turmaDoAluno(turmaId: string) {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) throw new NotFoundException('Turma não encontrada.');
    await this.assertPlano(turma.professorId);
    return turma;
  }

  /** Pergunta de outro aluno é 404: nem a existência vaza (#11). */
  private async perguntaDoAluno(
    { alunoId, turmaId }: Aluno,
    id: string,
  ): Promise<PerguntaEntity> {
    const p = await this.perguntas.findById(id);
    if (!p || p.alunoId !== alunoId || p.turmaId !== turmaId) {
      throw new NotFoundException('Pergunta não encontrada.');
    }
    return p;
  }

  private async perguntaDaTurma(
    turmaId: string,
    id: string,
  ): Promise<PerguntaEntity> {
    const p = await this.perguntas.findById(id);
    if (!p || p.turmaId !== turmaId) {
      throw new NotFoundException('Pergunta não encontrada.');
    }
    return p;
  }

  private async nomesDaTurma(turmaId: string) {
    return new Map(
      (await this.alunoRepo.findByTurma(turmaId)).map((a) => [a.id, a]),
    );
  }

  private estado(turma: {
    perguntasAbertas?: boolean;
    perguntasAbertasDesde?: string | null;
  }): EstadoJanelaPerguntas {
    const abertas = turma.perguntasAbertas === true;
    return {
      abertas,
      desde: abertas ? (turma.perguntasAbertasDesde ?? null) : null,
    };
  }

  /** Mesmo gate do portal do aluno (recurso GAMIFICACAO, #17). */
  private async assertPlano(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message:
          'As perguntas fazem parte do portal do aluno, exclusivo do plano PhD.',
      });
    }
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
