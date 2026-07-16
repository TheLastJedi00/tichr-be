import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import {
  PlanoAtual,
  ProfessorEntity,
} from '../professor/entities/professor.entity';
import { TurmaEntity } from '../turma/entities/turma.entity';
import { sendOobCode, signInComSenha } from '../auth/identity-toolkit';

/** Visao geral do negocio (dashboard do backoffice). */
export interface AdminMetrics {
  totalProfessores: number;
  ativos: number;
  desativados: number;
  porPlano: Record<PlanoAtual, number>;
}

/** Uso agregado de um professor (CRM interno). */
export interface UsoProfessor {
  turmasAtivas: number;
  alunos: number;
  qlicks: number;
}

/** Linha do CRM: dados do professor + uso. */
export interface UsuarioAdminView {
  uid: string;
  email?: string;
  nomeExibicao?: string;
  username?: string;
  planoAtual: PlanoAtual;
  desativadoEm?: string;
  uso: UsoProfessor;
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Orquestrador do backoffice. Le as colecoes diretamente (professores/turmas/
 * alunos/qlicks) e agrega em memoria — escala de admin, sem indices compostos.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.firebase.firestore;
  }

  async metrics(): Promise<AdminMetrics> {
    const hoje = hojeISO();
    const [profSnap, turmaSnap] = await Promise.all([
      this.db.collection('professores').get(),
      this.db.collection('turmas').get(),
    ]);

    const porPlano: Record<PlanoAtual, number> = {
      ESTAGIARIO: 0,
      GRADUADO: 0,
      MESTRE: 0,
      PHD: 0,
    };
    let desativados = 0;
    profSnap.docs.forEach((d) => {
      const p = plainToInstance(ProfessorEntity, { ...d.data(), uid: d.id });
      porPlano[p.planoAtual ?? 'ESTAGIARIO'] += 1;
      if (p.desativadoEm) desativados += 1;
    });

    const ativos = new Set<string>();
    turmaSnap.docs.forEach((d) => {
      const t = plainToInstance(TurmaEntity, { ...d.data(), id: d.id });
      if (t.contaComoAtiva(hoje)) ativos.add(t.professorId);
    });

    return {
      totalProfessores: profSnap.size,
      ativos: ativos.size,
      desativados,
      porPlano,
    };
  }

  /** CRM: lista/pesquisa professores com uso agregado. */
  async listarUsuarios(busca?: string): Promise<UsuarioAdminView[]> {
    const hoje = hojeISO();
    const [profSnap, turmaSnap, alunoSnap, qlickSnap] = await Promise.all([
      this.db.collection('professores').get(),
      this.db.collection('turmas').get(),
      this.db.collection('alunos').get(),
      this.db.collection('qlicks').get(),
    ]);

    const turmasByProf = new Map<string, TurmaEntity[]>();
    const turmaProf = new Map<string, string>();
    turmaSnap.docs.forEach((d) => {
      const t = plainToInstance(TurmaEntity, { ...d.data(), id: d.id });
      turmaProf.set(t.id, t.professorId);
      const lista = turmasByProf.get(t.professorId) ?? [];
      lista.push(t);
      turmasByProf.set(t.professorId, lista);
    });

    const alunosByProf = new Map<string, number>();
    alunoSnap.docs.forEach((d) => {
      const prof = turmaProf.get(d.data().turmaId as string);
      if (prof) alunosByProf.set(prof, (alunosByProf.get(prof) ?? 0) + 1);
    });

    const qlicksByProf = new Map<string, number>();
    qlickSnap.docs.forEach((d) => {
      const prof = d.data().professorId as string | undefined;
      if (prof) qlicksByProf.set(prof, (qlicksByProf.get(prof) ?? 0) + 1);
    });

    const emails = await this.emailsDe(profSnap.docs.map((d) => d.id));

    let views: UsuarioAdminView[] = profSnap.docs.map((d) => {
      const p = plainToInstance(ProfessorEntity, { ...d.data(), uid: d.id });
      const turmasAtivas = (turmasByProf.get(p.uid) ?? []).filter((t) =>
        t.contaComoAtiva(hoje),
      ).length;
      return {
        uid: p.uid,
        email: emails.get(p.uid),
        nomeExibicao: p.nomeExibicao,
        username: p.username,
        planoAtual: p.planoAtual ?? 'ESTAGIARIO',
        desativadoEm: p.desativadoEm,
        uso: {
          turmasAtivas,
          alunos: alunosByProf.get(p.uid) ?? 0,
          qlicks: qlicksByProf.get(p.uid) ?? 0,
        },
      };
    });

    const q = busca?.trim().toLowerCase();
    if (q) {
      views = views.filter((v) =>
        [v.nomeExibicao, v.username, v.email].some((s) =>
          s?.toLowerCase().includes(q),
        ),
      );
    }
    return views.sort((a, b) =>
      (a.nomeExibicao ?? a.email ?? a.uid).localeCompare(
        b.nomeExibicao ?? b.email ?? b.uid,
      ),
    );
  }

  async detalheUsuario(uid: string): Promise<UsuarioAdminView> {
    const v = (await this.listarUsuarios()).find((x) => x.uid === uid);
    if (!v) throw new NotFoundException('Professor nao encontrado.');
    return v;
  }

  /** Dispara o e-mail de redefinicao de senha (Identity Toolkit). */
  async resetSenha(uid: string): Promise<{ email: string; enviado: boolean }> {
    const user = await this.firebase.auth.getUser(uid);
    if (!user.email) {
      throw new BadRequestException('Usuario sem e-mail cadastrado.');
    }
    const apiKey = this.config.get<string>('FIREBASE_WEB_API_KEY');
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY nao configurada.');

    try {
      await sendOobCode(apiKey, {
        requestType: 'PASSWORD_RESET',
        email: user.email,
      });
    } catch {
      throw new BadRequestException('Falha ao enviar o e-mail de redefinicao.');
    }
    return { email: user.email, enviado: true };
  }

  /**
   * Reset de dados: apaga turmas/alunos e TODAS as bibliotecas de jogos do
   * professor, mantendo o login. É a mesma cascata usada na auto-exclusão da
   * conta (LGPD), então nenhuma coleção de conteúdo pode ficar de fora — senão o
   * material do professor sobrevive à exclusão da conta dele.
   */
  async limparDados(
    uid: string,
  ): Promise<{ turmas: number; qlicks: number; jogos: number }> {
    const turmas = await this.db
      .collection('turmas')
      .where('professorId', '==', uid)
      .get();
    const [qlicks, worJogos, isolateusJogos] = await Promise.all(
      ['qlicks', 'wor_jogos', 'isolateus_jogos'].map((colecao) =>
        this.db.collection(colecao).where('professorId', '==', uid).get(),
      ),
    );

    const batch = this.db.batch();
    for (const t of turmas.docs) {
      batch.delete(t.ref);
      const alunos = await this.db
        .collection('alunos')
        .where('turmaId', '==', t.id)
        .get();
      alunos.docs.forEach((a) => batch.delete(a.ref));
    }
    for (const snap of [qlicks, worJogos, isolateusJogos]) {
      snap.docs.forEach((d) => batch.delete(d.ref));
    }
    await batch.commit();
    return {
      turmas: turmas.size,
      qlicks: qlicks.size,
      jogos: qlicks.size + worJogos.size + isolateusJogos.size,
    };
  }

  /**
   * Auto-exclusão do titular: confirma a senha (reautenticação via Identity
   * Toolkit) e faz o **hard delete** da própria conta (dados em cascata + doc do
   * professor + usuário do Auth). Ação irreversível, disparada pelo próprio dono.
   */
  async excluirPropriaConta(
    uid: string,
    senha: string,
  ): Promise<{ modo: 'soft' | 'hard' }> {
    const user = await this.firebase.auth.getUser(uid);
    if (!user.email) {
      throw new BadRequestException('Usuario sem e-mail cadastrado.');
    }
    const apiKey = this.config.get<string>('FIREBASE_WEB_API_KEY');
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY nao configurada.');

    try {
      await signInComSenha(apiKey, user.email, senha, false);
    } catch {
      throw new UnauthorizedException({
        code: 'SENHA_INVALIDA',
        message: 'Senha incorreta. A conta nao foi excluida.',
      });
    }
    return this.excluirUsuario(uid, true);
  }

  /** Soft delete (flag) ou hard delete (dados + login). */
  async excluirUsuario(
    uid: string,
    hard: boolean,
  ): Promise<{ modo: 'soft' | 'hard' }> {
    if (!hard) {
      await this.db
        .collection('professores')
        .doc(uid)
        .set({ desativadoEm: new Date().toISOString() }, { merge: true });
      return { modo: 'soft' };
    }
    await this.limparDados(uid);
    await this.db.collection('professores').doc(uid).delete();
    try {
      await this.firebase.auth.deleteUser(uid);
    } catch {
      // usuario pode nao existir no Auth; segue sem falhar o hard delete.
    }
    return { modo: 'hard' };
  }

  /** Override manual de plano (sem cobranca). */
  async alterarPlano(
    uid: string,
    plano: PlanoAtual,
  ): Promise<{ uid: string; planoAtual: PlanoAtual }> {
    await this.db
      .collection('professores')
      .doc(uid)
      .set({ planoAtual: plano }, { merge: true });
    return { uid, planoAtual: plano };
  }

  /**
   * Concede/revoga acesso de admin gravando `isAdmin` no doc do professor
   * (fonte de verdade no Firestore). Vale na hora, sem exigir re-login.
   */
  async definirAdmin(
    uid: string,
    conceder: boolean,
  ): Promise<{ uid: string; admin: boolean }> {
    await this.db
      .collection('professores')
      .doc(uid)
      .set({ isAdmin: conceder }, { merge: true });
    return { uid, admin: conceder };
  }

  /** E-mails do Firebase Auth em lote (chunks de 100). */
  private async emailsDe(uids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100).map((uid) => ({ uid }));
      if (!chunk.length) break;
      const res = await this.firebase.auth.getUsers(chunk);
      res.users.forEach((u) => {
        if (u.email) map.set(u.uid, u.email);
      });
    }
    return map;
  }
}
