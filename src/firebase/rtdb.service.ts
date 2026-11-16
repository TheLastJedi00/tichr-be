import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from './firebase.service';

/**
 * Cliente mínimo do Realtime Database pela **API REST** (spec 034).
 *
 * Não usa `admin.database()`: ele abre uma conexão persistente, ruim em função
 * serverless. Cada chamada é um HTTP com o access token da service account.
 * Sem `FIREBASE_DATABASE_URL` o canal fica desabilitado (`habilitado = false`).
 */
@Injectable()
export class RtdbService {
  constructor(
    private readonly config: ConfigService,
    private readonly firebase: FirebaseService,
  ) {}

  private get base(): string | undefined {
    return this.config.get<string>('FIREBASE_DATABASE_URL')?.replace(/\/$/, '');
  }

  get habilitado(): boolean {
    return !!this.base;
  }

  private async url(caminho: string): Promise<string> {
    const token = await this.firebase.accessToken();
    return `${this.base}/${caminho}.json?access_token=${encodeURIComponent(token)}`;
  }

  async ler<T = unknown>(caminho: string): Promise<T | null> {
    const r = await fetch(await this.url(caminho));
    if (!r.ok) throw new Error(`RTDB GET ${r.status}`);
    return (await r.json()) as T | null;
  }

  /** `PATCH`: mescla os campos no nó (cria se não existe). */
  async gravar(caminho: string, valor: object): Promise<void> {
    const r = await fetch(await this.url(caminho), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valor),
    });
    if (!r.ok) throw new Error(`RTDB PATCH ${r.status}`);
  }

  async apagar(caminho: string): Promise<void> {
    const r = await fetch(await this.url(caminho), { method: 'DELETE' });
    if (!r.ok) throw new Error(`RTDB DELETE ${r.status}`);
  }
}
