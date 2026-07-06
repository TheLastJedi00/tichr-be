import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';

/** Por quanto tempo após a criação a partida continua "de hoje" para o aluno. */
const JANELA_VISIBILIDADE_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Estado fragmentado: raiz `matches/{id}` (global) + subcoleção
 * `matches/{id}/teams/{teamId}` (por equipe). Só o backend escreve.
 */
@Injectable()
export class WorMatchRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get col() {
    return this.firebase.firestore.collection('matches');
  }
  private teamsCol(matchId: string) {
    return this.col.doc(matchId).collection('teams');
  }
  private semId<T extends { id?: string }>(data: T): Omit<T, 'id'> {
    const plain = { ...data };
    delete plain.id;
    return plain;
  }

  async criar(data: Omit<WorMatchEntity, 'id'>): Promise<WorMatchEntity> {
    const ref = await this.col.add(this.semId(data as WorMatchEntity));
    return plainToInstance(WorMatchEntity, { ...data, id: ref.id });
  }

  async buscar(id: string): Promise<WorMatchEntity | null> {
    const snap = await this.col.doc(id).get();
    return snap.exists
      ? plainToInstance(WorMatchEntity, { ...snap.data(), id: snap.id })
      : null;
  }

  async atualizar(id: string, dados: Partial<WorMatchEntity>): Promise<void> {
    await this.col.doc(id).set(this.semId({ ...dados }), { merge: true });
  }

  /**
   * Partida não encerrada mais recente de uma turma (lobby ou em andamento),
   * desde que criada há pouco (janela de visibilidade de 12h) — o gatilho é o
   * professor ter rodado, sem depender do relógio do servidor. Espelha o Qlick.
   */
  async ativaDaTurma(turmaId: string): Promise<WorMatchEntity | null> {
    const limite = Date.now() - JANELA_VISIBILIDADE_MS;
    const snap = await this.col.where('turmaId', '==', turmaId).get();
    const ativas = snap.docs
      .map((d) => plainToInstance(WorMatchEntity, { ...d.data(), id: d.id }))
      .filter((m) => m.status !== 'ENCERRADO')
      .filter((m) => !m.criadaEm || Date.parse(m.criadaEm) >= limite)
      .sort((a, b) => (b.criadaEm ?? '').localeCompare(a.criadaEm ?? ''));
    return ativas[0] ?? null;
  }

  // --- Equipes (subcoleção) ---

  async criarTeam(
    matchId: string,
    teamId: string,
    data: Omit<WorTeamEntity, 'id' | 'aplicarDano' | 'curar'>,
  ): Promise<WorTeamEntity> {
    await this.teamsCol(matchId).doc(teamId).set({ ...data });
    return plainToInstance(WorTeamEntity, { ...data, id: teamId });
  }

  async listarTeams(matchId: string): Promise<WorTeamEntity[]> {
    const snap = await this.teamsCol(matchId).get();
    return snap.docs.map((d) =>
      plainToInstance(WorTeamEntity, { ...d.data(), id: d.id }),
    );
  }

  async buscarTeam(
    matchId: string,
    teamId: string,
  ): Promise<WorTeamEntity | null> {
    const snap = await this.teamsCol(matchId).doc(teamId).get();
    return snap.exists
      ? plainToInstance(WorTeamEntity, { ...snap.data(), id: snap.id })
      : null;
  }

  async atualizarTeam(
    matchId: string,
    teamId: string,
    dados: Partial<WorTeamEntity>,
  ): Promise<void> {
    await this.teamsCol(matchId)
      .doc(teamId)
      .set(this.semId({ ...dados }), { merge: true });
  }
}
