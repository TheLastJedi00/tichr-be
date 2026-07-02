import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const base64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT');

    if (!base64) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT nao configurada nas variaveis de ambiente.',
      );
    }

    const serviceAccount = JSON.parse(
      Buffer.from(base64, 'base64').toString('utf8'),
    );

    const existing = getApps();
    this.app =
      existing.length > 0
        ? existing[0]
        : initializeApp({ credential: cert(serviceAccount) });
  }

  get firestore(): Firestore {
    return getFirestore(this.app);
  }

  get auth(): Auth {
    return getAuth(this.app);
  }
}
