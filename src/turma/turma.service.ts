import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hojeISO } from '../common/date.util';
import { paraPlano } from '../common/plain.util';
import { montarBloqueador } from './ferias.util';
import {
  LIMITE_ALUNOS_TURMA,
  LIMITE_TURMAS_ATIVAS,
  proximoPinCurto,
} from '../common/pin.util';
import { AlunoEntity } from './entities/aluno.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateFeriasDto } from './dto/create-ferias.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { ExcecaoEntity } from './entities/excecao.entity';
import { FeriasEntity } from './entities/ferias.entity';
import { SessaoAulaEntity } from './entities/sessao-aula.entity';
import {
  diasDaGrade,
  NIVEIS_TURMA_DEFAULT,
  TurmaEntity,
} from './entities/turma.entity';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { FeriasRepository } from './repositories/ferias.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class TurmaService {
  constructor(
    private readonly turmaRepo: TurmaRepository,
    private readonly sessaoRepo: SessaoRepository,
    private readonly excecaoRepo: ExcecaoRepository,
    private readonly feriasRepo: FeriasRepository,
    private readonly alunoRepo: AlunoRepository,
  ) {}

  listarFerias(professorId: string): Promise<FeriasEntity[]> {
    return this.feriasRepo.findByProfessor(professorId);
  }

  /** Cadastra um periodo de ferias e recalcula a agenda do professor. */
  async criarFerias(
    professorId: string,
    dto: CreateFeriasDto,
  ): Promise<{ ferias: FeriasEntity; turmasRecalculadas: number }> {
    const ferias = await this.feriasRepo.create(
      new FeriasEntity({ ...dto, professorId }),
    );
    const turmasRecalculadas = await this.recalcularTurmas(professorId);
    return { ferias, turmasRecalculadas };
  }

  /** Remove um periodo de ferias e recalcula a agenda. */
  async removerFerias(
    professorId: string,
    feriasId: string,
  ): Promise<{ turmasRecalculadas: number }> {
    const ferias = await this.feriasRepo.findById(feriasId);
    if (!ferias || ferias.professorId !== professorId) {
      throw new NotFoundException('Ferias nao encontradas.');
    }
    await this.feriasRepo.delete(feriasId);
    const turmasRecalculadas = await this.recalcularTurmas(professorId);
    return { turmasRecalculadas };
  }

  /** Cria a turma, projeta as sessoes e persiste tudo. */
  async criarTurma(
    professorId: string,
    dto: CreateTurmaDto,
  ): Promise<{ turma: TurmaEntity; sessoes: SessaoAulaEntity[] }> {
    const existentes = await this.turmaRepo.findByProfessor(professorId);
    const hoje = hojeISO();
    const ativas = existentes.filter((t) => t.contaComoAtiva(hoje));
    if (ativas.length >= LIMITE_TURMAS_ATIVAS) {
      throw new BadRequestException({
        code: 'LIMITE_TURMAS',
        message: `Limite de ${LIMITE_TURMAS_ATIVAS} turmas ativas atingido.`,
      });
    }
    const pinsUsados = new Set(
      ativas.map((t) => t.pinTurma).filter((p): p is string => !!p),
    );
    const turma = new TurmaEntity({
      ...dto,
      professorId,
      // Turma regular: os dias vem das alocacoes na grade (nao do campo cru).
      diasSemana:
        dto.ensinoRegular && dto.gradeHoraria?.length
          ? diasDaGrade(dto.gradeHoraria)
          : dto.diasSemana,
      // DTOs viram objetos planos — o Firestore recusa prototipos de classe.
      gradeHoraria: paraPlano(dto.gradeHoraria),
      ativo: true,
      pinTurma: this.gerarPinTurma(pinsUsados),
    });
    const salva = await this.turmaRepo.create(turma);

    const bloqueadas = await this.datasBloqueadas(professorId, salva.id);
    const sessoes = await this.reprojetar(salva, bloqueadas);
    return { turma: salva, sessoes };
  }

  /** Gera um Smart PIN de 2 digitos ainda nao usado nas turmas ativas do professor. */
  private gerarPinTurma(usados: Set<string>): string {
    const pin = proximoPinCurto(usados);
    if (!pin) {
      throw new BadRequestException({
        code: 'LIMITE_TURMAS',
        message: `Limite de ${LIMITE_TURMAS_ATIVAS} turmas ativas atingido.`,
      });
    }
    return pin;
  }

  /**
   * Migracao para Smart PINs: regenera o PIN da turma (2 dig) e redistribui os
   * PINs dos alunos sequencialmente ('01', '02', ...). Usado nas turmas legadas
   * (PIN de 6 dig) para adotar o novo formato do Tichr Qlick.
   */
  async migrarPins(
    professorId: string,
    turmaId: string,
  ): Promise<{ turma: TurmaEntity; alunos: AlunoEntity[] }> {
    const turma = await this.buscarTurma(professorId, turmaId);
    const hoje = hojeISO();
    const outras = (await this.turmaRepo.findByProfessor(professorId)).filter(
      (t) => t.id !== turmaId && t.contaComoAtiva(hoje),
    );
    const usados = new Set(
      outras.map((t) => t.pinTurma).filter((p): p is string => !!p),
    );
    const novoPin = this.gerarPinTurma(usados);
    turma.pinTurma = novoPin;
    await this.turmaRepo.update(turmaId, { pinTurma: novoPin });

    const alunos = await this.alunoRepo.findByTurma(turmaId);
    if (alunos.length > LIMITE_ALUNOS_TURMA) {
      throw new BadRequestException({
        code: 'LIMITE_ALUNOS',
        message: `Limite de ${LIMITE_ALUNOS_TURMA} alunos por turma atingido.`,
      });
    }
    // Sequencia estavel por nome: '01', '02', ...
    alunos.sort((a, b) => a.nome.localeCompare(b.nome));
    let i = 1;
    for (const aluno of alunos) {
      const pin = String(i++).padStart(2, '0');
      aluno.pinAcesso = pin;
      await this.alunoRepo.update(aluno.id, { pinAcesso: pin });
    }
    return { turma, alunos };
  }

  /**
   * Encerra a turma (Hall da Fama): marca `encerradaManualmente`, tornando-a
   * **somente leitura**. Deixa de contar como ativa → o Smart PIN de 2 díg volta
   * ao pool para a próxima turma criada.
   */
  async encerrar(professorId: string, turmaId: string): Promise<TurmaEntity> {
    const turma = await this.buscarTurma(professorId, turmaId);
    turma.encerradaManualmente = true;
    await this.turmaRepo.update(turmaId, { encerradaManualmente: true });
    return turma;
  }

  /** Cadastra uma excecao e dispara o recalculo das turmas do professor. */
  async adicionarExcecao(
    professorId: string,
    dto: CreateExcecaoDto,
  ): Promise<{ excecao: ExcecaoEntity; turmasRecalculadas: number }> {
    const excecao = await this.excecaoRepo.create({ ...dto, professorId });
    const turmasRecalculadas = await this.recalcularTurmas(professorId);
    return { excecao, turmasRecalculadas };
  }

  async listarSessoes(professorId: string): Promise<SessaoAulaEntity[]> {
    return this.sessaoRepo.findByProfessor(professorId);
  }

  async listarTurmas(professorId: string): Promise<TurmaEntity[]> {
    return this.turmaRepo.findByProfessor(professorId);
  }

  /** Quantidade de turmas do professor que ocupam cota do plano. */
  async contarTurmasAtivas(professorId: string): Promise<number> {
    return this.turmaRepo.contarTurmasAtivas(professorId);
  }

  async buscarTurma(professorId: string, turmaId: string): Promise<TurmaEntity> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    // Backfill: turmas criadas antes do pinTurma ganham um ao serem abertas.
    if (!turma.pinTurma) {
      const existentes = await this.turmaRepo.findByProfessor(professorId);
      const usados = new Set(
        existentes.map((t) => t.pinTurma).filter((p): p is string => !!p),
      );
      turma.pinTurma = this.gerarPinTurma(usados);
      await this.turmaRepo.update(turmaId, { pinTurma: turma.pinTurma });
    }
    return turma;
  }

  /** Atualiza os dados da turma e reprojeta as sessoes. */
  async atualizarTurma(
    professorId: string,
    turmaId: string,
    dto: UpdateTurmaDto,
  ): Promise<{ turma: TurmaEntity; sessoes: SessaoAulaEntity[] }> {
    const turma = await this.buscarTurma(professorId, turmaId);

    const ensinoRegular = dto.ensinoRegular ?? turma.ensinoRegular ?? false;
    const gradeHoraria = dto.gradeHoraria
      ? paraPlano(dto.gradeHoraria)
      : turma.gradeHoraria;
    // Turma regular deriva os dias das alocacoes; senao usa o campo cru.
    const diasSemana =
      ensinoRegular && gradeHoraria?.length
        ? diasDaGrade(gradeHoraria)
        : (dto.diasSemana ?? turma.diasSemana);

    const campos: Partial<TurmaEntity> = {
      nome: dto.nome ?? turma.nome,
      tipoModalidade: dto.tipoModalidade ?? turma.tipoModalidade,
      diasSemana,
      instituicaoId: dto.instituicaoId ?? turma.instituicaoId,
      ensinoRegular,
      nivelEnsino: dto.nivelEnsino ?? turma.nivelEnsino,
      anoSerie: dto.anoSerie ?? turma.anoSerie,
      turno: dto.turno ?? turma.turno,
      gradeHoraria,
      dataInicio: dto.dataInicio ?? turma.dataInicio,
      totalAulas: dto.totalAulas ?? turma.totalAulas,
      cor: dto.cor ?? turma.cor,
      disciplina: dto.disciplina ?? turma.disciplina,
      horaInicio: dto.horaInicio ?? turma.horaInicio,
      horaFim: dto.horaFim ?? turma.horaFim,
      encerradaManualmente:
        dto.encerradaManualmente ?? turma.encerradaManualmente ?? false,
      pontuacaoAtiva: dto.pontuacaoAtiva ?? turma.pontuacaoAtiva ?? true,
      nomePontuacao: dto.nomePontuacao ?? turma.nomePontuacao ?? 'XP',
      rankingAtivo: dto.rankingAtivo ?? turma.rankingAtivo ?? true,
      rotuloAdicionar:
        dto.rotuloAdicionar ?? turma.rotuloAdicionar ?? 'Adicionar',
      rotuloRemover: dto.rotuloRemover ?? turma.rotuloRemover ?? 'Remover',
      nivelPrata: dto.nivelPrata ?? turma.nivelPrata ?? NIVEIS_TURMA_DEFAULT.prata,
      nivelOuro: dto.nivelOuro ?? turma.nivelOuro ?? NIVEIS_TURMA_DEFAULT.ouro,
      nivelDiamante:
        dto.nivelDiamante ?? turma.nivelDiamante ?? NIVEIS_TURMA_DEFAULT.diamante,
      nivelPlatina:
        dto.nivelPlatina ?? turma.nivelPlatina ?? NIVEIS_TURMA_DEFAULT.platina,
    };
    Object.assign(turma, campos);
    await this.turmaRepo.update(turmaId, campos);

    const bloqueadas = await this.datasBloqueadas(professorId, turmaId);
    const sessoes = await this.reprojetar(turma, bloqueadas);
    return { turma, sessoes };
  }

  /** Reprojeta todas as turmas ativas do professor com o calendario atual. */
  private async recalcularTurmas(professorId: string): Promise<number> {
    const turmas = await this.turmaRepo.findByProfessor(professorId);
    const ativas = turmas.filter((t) => t.ativo);
    const bloqueador = await this.carregarBloqueador(professorId);
    for (const turma of ativas) {
      await this.reprojetar(turma, bloqueador(turma.id));
    }
    return ativas.length;
  }

  /**
   * Regenera as sessoes de uma turma: limpa as antigas, projeta com as
   * datas bloqueadas (excecoes + ferias), atualiza a dataFimPrevista e persiste.
   */
  private async reprojetar(
    turma: TurmaEntity,
    bloqueadas: Set<string>,
  ): Promise<SessaoAulaEntity[]> {
    const sessoes = turma.projetarSessoes(bloqueadas);

    await this.sessaoRepo.deleteByTurma(turma.id);

    // Sempre grava a dataFimPrevista (null p/ grade fixa) para limpar valor
    // antigo ao trocar de modulo para grade fixa numa edicao.
    const fim = turma.calcularFimPrevisto(sessoes.map((s) => s.data)) ?? null;
    await this.turmaRepo.update(turma.id, {
      dataFimPrevista: fim,
    } as Partial<TurmaEntity>);
    turma.dataFimPrevista = fim ?? undefined;

    // Persiste as sessoes em paralelo (docs independentes) — evita N
    // round-trips sequenciais e deixa a reprojecao muito mais rapida.
    return Promise.all(sessoes.map((sessao) => this.sessaoRepo.create(sessao)));
  }

  /** Datas bloqueadas de uma turma especifica (excecoes + ferias aplicaveis). */
  private async datasBloqueadas(
    professorId: string,
    turmaId: string,
  ): Promise<Set<string>> {
    const bloqueador = await this.carregarBloqueador(professorId);
    return bloqueador(turmaId);
  }

  /**
   * Carrega excecoes e ferias uma vez e devolve uma funcao que, dado o id da
   * turma, retorna o conjunto de datas bloqueadas: excecoes + ferias globais +
   * ferias daquela turma.
   */
  private async carregarBloqueador(
    professorId: string,
  ): Promise<(turmaId: string) => Set<string>> {
    const [excecoes, ferias, turmas] = await Promise.all([
      this.excecaoRepo.findByProfessor(professorId),
      this.feriasRepo.findByProfessor(professorId),
      this.turmaRepo.findByProfessor(professorId),
    ]);
    const instDaTurma = new Map(turmas.map((t) => [t.id, t.instituicaoId]));
    return montarBloqueador(
      excecoes.map((e) => e.data),
      ferias,
      instDaTurma,
    );
  }
}
