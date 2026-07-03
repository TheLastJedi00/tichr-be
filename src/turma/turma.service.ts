import { Injectable, NotFoundException } from '@nestjs/common';
import { expandirIntervalo } from '../common/date.util';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateFeriasDto } from './dto/create-ferias.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { ExcecaoEntity } from './entities/excecao.entity';
import { FeriasEntity } from './entities/ferias.entity';
import { SessaoAulaEntity } from './entities/sessao-aula.entity';
import { TurmaEntity } from './entities/turma.entity';
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
    const pinsUsados = new Set(
      existentes.map((t) => t.pinTurma).filter((p): p is string => !!p),
    );
    const turma = new TurmaEntity({
      ...dto,
      professorId,
      ativo: true,
      pinTurma: this.gerarPinTurma(pinsUsados),
    });
    const salva = await this.turmaRepo.create(turma);

    const bloqueadas = await this.datasBloqueadas(professorId, salva.id);
    const sessoes = await this.reprojetar(salva, bloqueadas);
    return { turma: salva, sessoes };
  }

  /** Gera um PIN de 6 digitos ainda nao usado nas turmas do professor. */
  private gerarPinTurma(usados: Set<string>): string {
    let pin: string;
    do {
      pin = String(Math.floor(100000 + Math.random() * 900000));
    } while (usados.has(pin));
    return pin;
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
    return turma;
  }

  /** Atualiza os dados da turma e reprojeta as sessoes. */
  async atualizarTurma(
    professorId: string,
    turmaId: string,
    dto: UpdateTurmaDto,
  ): Promise<{ turma: TurmaEntity; sessoes: SessaoAulaEntity[] }> {
    const turma = await this.buscarTurma(professorId, turmaId);

    const campos: Partial<TurmaEntity> = {
      nome: dto.nome ?? turma.nome,
      tipoModalidade: dto.tipoModalidade ?? turma.tipoModalidade,
      diasSemana: dto.diasSemana ?? turma.diasSemana,
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
    const [excecoes, ferias] = await Promise.all([
      this.excecaoRepo.findByProfessor(professorId),
      this.feriasRepo.findByProfessor(professorId),
    ]);

    const base = new Set(excecoes.map((e) => e.data));
    const porTurma = new Map<string, string[]>();
    for (const f of ferias) {
      const dias = expandirIntervalo(f.dataInicio, f.dataFim);
      if (f.turmaId) {
        porTurma.set(f.turmaId, [...(porTurma.get(f.turmaId) ?? []), ...dias]);
      } else {
        for (const d of dias) base.add(d);
      }
    }

    return (turmaId: string) =>
      new Set([...base, ...(porTurma.get(turmaId) ?? [])]);
  }
}
