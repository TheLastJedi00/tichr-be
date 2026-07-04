import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hojeISO } from '../common/date.util';
import { LIMITE_ALUNOS_TURMA, proximoPinCurto } from '../common/pin.util';
import { AlunoEntity } from './entities/aluno.entity';
import { SessaoAulaEntity } from './entities/sessao-aula.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { EquipeRepository } from './repositories/equipe.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { BASE_POR_AULA, XpService } from './xp.service';

@Injectable()
export class AlunoService {
  constructor(
    private readonly alunoRepo: AlunoRepository,
    private readonly turmaRepo: TurmaRepository,
    private readonly sessaoRepo: SessaoRepository,
    private readonly equipeRepo: EquipeRepository,
    private readonly xpService: XpService,
  ) {}

  /** Perfil do proprio aluno (portal). Sincroniza a base passiva antes. */
  async perfil(alunoId: string): Promise<AlunoEntity> {
    const atual = await this.alunoRepo.findById(alunoId);
    if (!atual) {
      throw new NotFoundException('Aluno nao encontrado.');
    }
    await this.xpService.sincronizarBaseTurma(atual.turmaId);
    return (await this.alunoRepo.findById(alunoId)) ?? atual;
  }

  /**
   * Progresso da turma: aulas concluidas / total (evolucao do curso).
   * `pontuacaoBase` = base coletiva que o andamento rendeu a cada aluno.
   */
  async progresso(turmaId: string): Promise<{
    concluidas: number;
    total: number;
    pct: number;
    pontuacaoBase: number;
  }> {
    const hoje = hojeISO();
    const sessoes = await this.sessaoRepo.findByTurma(turmaId);
    const validas = sessoes.filter((s) => s.status !== 'CANCELADA');
    const concluidas = validas.filter((s) => s.data < hoje).length;
    const total = validas.length;
    const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0;
    return { concluidas, total, pct, pontuacaoBase: concluidas * BASE_POR_AULA };
  }

  /** Agenda (sessoes ja recalculadas) da turma do aluno, ordenada por numero. */
  async agenda(turmaId: string): Promise<SessaoAulaEntity[]> {
    const sessoes = await this.sessaoRepo.findByTurma(turmaId);
    return sessoes.sort((a, b) => a.numero - b.numero);
  }

  /** Garante que a turma existe e pertence ao professor autenticado. */
  private async assertTurma(professorId: string, turmaId: string): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
  }

  /** Versao publica do assert de posse (usada por outros controllers). */
  garantirPosse(professorId: string, turmaId: string): Promise<void> {
    return this.assertTurma(professorId, turmaId);
  }

  /** Ranking da turma: alunos ordenados por XP decrescente com posicionamento. */
  async ranking(
    turmaId: string,
  ): Promise<
    Array<{ posicao: number; alunoId: string; nome: string; xpTotal: number }>
  > {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    if (!turma.configPontuacao.rankingAtivo) {
      throw new ForbiddenException('O ranking esta desativado nesta turma.');
    }
    await this.xpService.sincronizarBaseTurma(turmaId);
    const alunos = await this.alunoRepo.findByTurma(turmaId);
    return alunos
      .sort((a, b) => (b.xpTotal ?? 0) - (a.xpTotal ?? 0))
      .map((a, i) => ({
        posicao: i + 1,
        alunoId: a.id,
        nome: a.nome,
        xpTotal: a.xpTotal ?? 0,
      }));
  }

  async listar(professorId: string, turmaId: string): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    await this.xpService.sincronizarBaseTurma(turmaId);
    return this.alunoRepo.findByTurma(turmaId);
  }

  /** Cadastra em lote: cria um aluno por nome (ignorando nomes vazios/repetidos). */
  async adicionar(
    professorId: string,
    turmaId: string,
    nomes: string[],
  ): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    const limpos = [
      ...new Set(nomes.map((n) => n.trim()).filter((n) => n.length > 0)),
    ];

    // Coleta os PINs ja usados na turma para garantir unicidade.
    const existentes = await this.alunoRepo.findByTurma(turmaId);
    if (existentes.length + limpos.length > LIMITE_ALUNOS_TURMA) {
      throw new BadRequestException({
        code: 'LIMITE_ALUNOS',
        message: `Limite de ${LIMITE_ALUNOS_TURMA} alunos por turma atingido.`,
      });
    }
    const pinsUsados = new Set(
      existentes.map((a) => a.pinAcesso).filter((p): p is string => !!p),
    );

    // Sequencial p/ manter a ordem dos Smart PINs ('01', '02', ...).
    const criados: AlunoEntity[] = [];
    for (const nome of limpos) {
      const pinAcesso = proximoPinCurto(pinsUsados);
      if (!pinAcesso) {
        throw new BadRequestException({
          code: 'LIMITE_ALUNOS',
          message: `Limite de ${LIMITE_ALUNOS_TURMA} alunos por turma atingido.`,
        });
      }
      pinsUsados.add(pinAcesso);
      criados.push(
        await this.alunoRepo.create(
          new AlunoEntity({ turmaId, nome, pinAcesso, xpTotal: 0 }),
        ),
      );
    }
    return criados;
  }

  /**
   * Move o aluno para uma equipe (drop manual) ou de volta ao pool (null).
   * Valida a posse da turma, do aluno e da equipe de destino.
   */
  async definirEquipe(
    professorId: string,
    turmaId: string,
    alunoId: string,
    equipeId: string | null,
  ): Promise<AlunoEntity> {
    await this.assertTurma(professorId, turmaId);
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }
    if (equipeId !== null) {
      const equipe = await this.equipeRepo.findById(equipeId);
      if (!equipe || equipe.turmaId !== turmaId) {
        throw new NotFoundException('Equipe nao encontrada.');
      }
    }
    await this.alunoRepo.definirEquipe(alunoId, equipeId);
    aluno.equipeId = equipeId;
    return aluno;
  }

  /** Renomeia um aluno da turma (valida posse). */
  async renomear(
    professorId: string,
    turmaId: string,
    alunoId: string,
    nome: string,
  ): Promise<AlunoEntity> {
    await this.assertTurma(professorId, turmaId);
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }
    aluno.nome = nome.trim();
    await this.alunoRepo.update(alunoId, { nome: aluno.nome });
    return aluno;
  }

  async remover(
    professorId: string,
    turmaId: string,
    alunoId: string,
  ): Promise<{ removido: boolean }> {
    await this.assertTurma(professorId, turmaId);
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }
    await this.alunoRepo.delete(alunoId);
    return { removido: true };
  }
}
