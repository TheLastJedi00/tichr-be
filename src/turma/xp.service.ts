import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { hojeISO } from '../common/date.util';
import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';

/** Pontuação base concedida por aula concluída (evolução passiva da turma). */
export const BASE_POR_AULA = 10;

@Injectable()
export class XpService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly sessaoRepo: SessaoRepository,
  ) {}

  /**
   * Sincroniza a "pontuação base" passiva: recompensa cada aluno pelas aulas já
   * concluídas que ainda não foram contabilizadas. Idempotente — `baseAteSessao`
   * guarda quantas aulas concluídas já renderam base, então reprocessar não
   * duplica. Silencioso quando a turma não gamifica.
   */
  async sincronizarBaseTurma(turmaId: string): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || !turma.configPontuacao.pontuacaoAtiva) {
      return;
    }
    const professor = await this.professorService.getProfile(turma.professorId);
    if (!professor.podeGamificar) {
      return;
    }

    const hoje = hojeISO();
    const sessoes = await this.sessaoRepo.findByTurma(turmaId);
    const concluidas = sessoes.filter(
      (s) => s.status !== 'CANCELADA' && s.data < hoje,
    ).length;
    if (concluidas === 0) {
      return;
    }

    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const db = this.firebase.firestore;
    const batch = db.batch();
    let mudou = false;

    for (const aluno of alunos) {
      const base = aluno.baseAteSessao ?? 0;
      if (base >= concluidas) {
        continue;
      }
      const pontos = (concluidas - base) * BASE_POR_AULA;
      batch.update(db.collection('alunos').doc(aluno.id), {
        xpTotal: (aluno.xpTotal ?? 0) + pontos,
        baseAteSessao: concluidas,
      });
      batch.set(db.collection('xp_logs').doc(), {
        alunoId: aluno.id,
        turmaId,
        pontos,
        motivo: 'BASE',
        data: new Date().toISOString(),
      });
      mudou = true;
    }

    if (mudou) {
      await batch.commit();
    }
  }

  /**
   * Distribui XP a um aluno: grava um evento em `xp_logs` e atualiza o
   * `xpTotal` do aluno numa transacao Firestore (mantem log e total coerentes).
   * O total nunca fica negativo.
   */
  async distribuir(
    professorId: string,
    turmaId: string,
    alunoId: string,
    pontos: number,
    motivo?: string,
  ): Promise<{ alunoId: string; xpTotal: number }> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message: 'A gamificacao e exclusiva do plano PhD.',
      });
    }
    if (!turma.configPontuacao.pontuacaoAtiva) {
      throw new BadRequestException('A pontuacao esta desativada nesta turma.');
    }
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }

    const db = this.firebase.firestore;
    const alunoRef = db.collection('alunos').doc(alunoId);
    const logRef = db.collection('xp_logs').doc();

    const novoXp = await db.runTransaction(async (tx) => {
      const snap = await tx.get(alunoRef);
      const atual = (snap.data()?.xpTotal as number | undefined) ?? 0;
      const novo = Math.max(0, atual + pontos);
      tx.update(alunoRef, { xpTotal: novo });
      tx.set(logRef, {
        alunoId,
        turmaId,
        pontos,
        motivo: motivo ?? null,
        data: new Date().toISOString(),
      });
      return novo;
    });

    return { alunoId, xpTotal: novoXp };
  }

  /**
   * Credita ao XP dos alunos os pontos de uma partida encerrada (Tichr Qlick ou
   * Wor, conforme `motivo`). O próprio jogo é a opção de gamificar (PhD), então
   * dispensa o gate de `pontuacaoAtiva`. Usa `increment` para somar sem corrida
   * com a base.
   */
  async creditarPartida(
    turmaId: string,
    pontosPorAluno: Array<{ alunoId: string; pontos: number }>,
    motivo: 'QLICK' | 'WOR' = 'QLICK',
  ): Promise<void> {
    const validos = pontosPorAluno.filter((p) => p.pontos > 0);
    if (validos.length === 0) {
      return;
    }
    const db = this.firebase.firestore;
    const batch = db.batch();
    for (const { alunoId, pontos } of validos) {
      const aluno = await this.alunoRepo.findById(alunoId);
      if (!aluno || aluno.turmaId !== turmaId) {
        continue;
      }
      batch.update(db.collection('alunos').doc(alunoId), {
        xpTotal: FieldValue.increment(pontos),
      });
      batch.set(db.collection('xp_logs').doc(), {
        alunoId,
        turmaId,
        pontos,
        motivo,
        data: new Date().toISOString(),
      });
    }
    await batch.commit();
  }
}
