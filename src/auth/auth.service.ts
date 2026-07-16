import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseService } from '../firebase/firebase.service';
import { TurmaEntity } from '../turma/entities/turma.entity';
import { StudentTokenPayload } from './auth.types';
import { comoHttp, signInComSenha, signUpComSenha } from './identity-toolkit';

/** Config de pontuacao exposta ao portal do aluno. */
export interface TurmaConfigPublica {
  nomePontuacao: string;
  rankingAtivo: boolean;
  /**
   * Limiares de nivel da TURMA (XP para Prata/Ouro/Diamante/Platina). Sem isso o
   * painel do aluno cai nos defaults e exibe uma patente que nao e a que o
   * professor configurou — a fonte de verdade e o documento da turma.
   */
  niveis: { prata: number; ouro: number; diamante: number; platina: number };
}

/** Versao vigente dos documentos legais aceitos no cadastro (auditoria LGPD). */
export const VERSAO_DOCUMENTOS_LEGAIS = 'v1';

export interface LoginResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
  uid: string;
  email: string;
}

export interface LoginAlunoResult {
  token: string;
  aluno: { id: string; nome: string; turmaId: string; xpTotal: number };
  turma: TurmaConfigPublica;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** Verifica um JWT customizado de aluno e devolve o payload. */
  verifyStudentToken(token: string): StudentTokenPayload {
    return this.jwt.verify<StudentTokenPayload>(token);
  }

  /**
   * Info publica para a tela de login do aluno: nome da turma + lista de nomes
   * (sem PINs) para o aluno se localizar no dropdown.
   */
  async infoTurmaLogin(turmaId: string): Promise<{
    turmaId: string;
    turmaNome: string;
    alunos: Array<{ id: string; nome: string }>;
    config: TurmaConfigPublica;
    pinAlunoLength: number;
  }> {
    const db = this.firebase.firestore;
    const turmaSnap = await db.collection('turmas').doc(turmaId).get();
    if (!turmaSnap.exists) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    const alunosSnap = await db
      .collection('alunos')
      .where('turmaId', '==', turmaId)
      .get();
    const pinAlunoLength =
      (alunosSnap.docs
        .map((d) => d.data().pinAcesso as string | undefined)
        .find((p) => !!p)?.length) ?? 4;
    return {
      turmaId,
      turmaNome: (turmaSnap.data()?.nome as string) ?? 'Turma',
      alunos: alunosSnap.docs.map((d) => ({
        id: d.id,
        nome: d.data().nome as string,
      })),
      config: this.configPublica(turmaSnap.data()),
      pinAlunoLength,
    };
  }

  /** Extrai a config publica de pontuacao com defaults via TurmaEntity. */
  private configPublica(data: unknown): TurmaConfigPublica {
    const cfg = new TurmaEntity((data ?? {}) as Partial<TurmaEntity>)
      .configPontuacao;
    return {
      nomePontuacao: cfg.nomePontuacao,
      rankingAtivo: cfg.rankingAtivo,
      niveis: cfg.niveis,
    };
  }

  /**
   * Login do aluno via portal (Plano PhD): casa turmaId + PIN e emite um JWT
   * customizado com role STUDENT (sem passar pelo Firebase — alunos nao tem email).
   */
  async loginAluno(turmaId: string, pin: string): Promise<LoginAlunoResult> {
    const snap = await this.firebase.firestore
      .collection('alunos')
      .where('turmaId', '==', turmaId)
      .get();

    const doc = snap.docs.find((d) => d.data().pinAcesso === pin);
    if (!doc) {
      throw new UnauthorizedException('Turma ou PIN invalidos.');
    }

    const data = doc.data();
    const token = await this.jwt.signAsync({
      role: 'STUDENT',
      alunoId: doc.id,
      turmaId,
    } satisfies StudentTokenPayload);

    const turmaSnap = await this.firebase.firestore
      .collection('turmas')
      .doc(turmaId)
      .get();

    return {
      token,
      aluno: {
        id: doc.id,
        nome: data.nome,
        turmaId,
        xpTotal: data.xpTotal ?? 0,
      },
      turma: this.configPublica(turmaSnap.data()),
    };
  }

  /**
   * Cadastro frictionless: cria o usuario no Identity Toolkit (o backend e o
   * dono da Web API key), provisiona o doc `professores/{uid}` minimo
   * (plano ESTAGIARIO) e devolve o ID token para auto-login imediato.
   */
  async signup(
    email: string,
    password: string,
    nome: string,
    aceiteTermos: boolean,
    aceitePrivacidade: boolean,
  ): Promise<LoginResult> {
    if (!aceiteTermos || !aceitePrivacidade) {
      throw new BadRequestException(
        'E preciso aceitar os Termos de Uso e a Politica de Privacidade.',
      );
    }
    const apiKey = this.apiKey();

    const tokens = await signUpComSenha(apiKey, email, password).catch(comoHttp);

    // Provisiona o perfil (ESTAGIARIO) ja com o nome e o registro de consentimento.
    const agora = new Date().toISOString();
    await this.firebase.firestore
      .collection('professores')
      .doc(tokens.uid)
      .set(
        {
          nomeExibicao: nome.trim(),
          planoAtual: 'ESTAGIARIO',
          slotsAdicionaisComprados: 0,
          aceiteTermosEm: agora,
          aceitePrivacidadeEm: agora,
          versaoDocumentosLegais: VERSAO_DOCUMENTOS_LEGAIS,
        },
        { merge: true },
      );

    return tokens;
  }

  /** Web API key do projeto; sem ela nenhum fluxo de credencial funciona. */
  private apiKey(): string {
    const apiKey = this.config.get<string>('FIREBASE_WEB_API_KEY');
    if (!apiKey) {
      throw new Error('FIREBASE_WEB_API_KEY nao configurada.');
    }
    return apiKey;
  }

  async verifyToken(token: string): Promise<DecodedIdToken> {
    try {
      return await this.firebase.auth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado.');
    }
  }

  /**
   * Autentica email/senha via Identity Toolkit REST (o backend e o dono da
   * Web API key) e devolve o ID token do Firebase para o cliente usar.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    try {
      return await signInComSenha(this.apiKey(), email, password);
    } catch (erro) {
      // Qualquer falha de credencial vira a mesma mensagem: nao entregamos ao
      // atacante a informacao de qual metade do par estava errada.
      throw new UnauthorizedException('Email ou senha invalidos.');
    }
  }
}
