import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class XpService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
  ) {}

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
}
