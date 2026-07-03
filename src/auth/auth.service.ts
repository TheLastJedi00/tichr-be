import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseService } from '../firebase/firebase.service';
import { StudentTokenPayload } from './auth.types';

const IDENTITY_TOOLKIT_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

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

    return {
      token,
      aluno: {
        id: doc.id,
        nome: data.nome,
        turmaId,
        xpTotal: data.xpTotal ?? 0,
      },
    };
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
    const apiKey = this.config.get<string>('FIREBASE_WEB_API_KEY');
    if (!apiKey) {
      throw new Error('FIREBASE_WEB_API_KEY nao configurada.');
    }

    const response = await fetch(`${IDENTITY_TOOLKIT_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });

    const data = (await response.json()) as {
      idToken?: string;
      refreshToken?: string;
      expiresIn?: string;
      localId?: string;
      email?: string;
    };

    if (!response.ok || !data.idToken) {
      throw new UnauthorizedException('Email ou senha invalidos.');
    }

    return {
      token: data.idToken,
      refreshToken: data.refreshToken ?? '',
      expiresIn: Number(data.expiresIn ?? 3600),
      uid: data.localId ?? '',
      email: data.email ?? email,
    };
  }
}
