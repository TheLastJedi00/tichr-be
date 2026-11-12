import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { DENUNCIA } from './denuncia.constants';

/**
 * A imagem anexada à denúncia (spec 032 #5). Diferente do avatar, NÃO ganha
 * token de download público: é foto de menor, só o professor dono vê, por URL
 * assinada de curta duração. Apagada quando a denúncia é resolvida.
 *
 * Spec 033: o envio saiu; restam a leitura e a remoção das fotos de legado
 * (pendentes criadas antes). Pode ser removido quando não houver mais nenhuma.
 */
@Injectable()
export class DenunciaImagemStorage {
  private readonly logger = new Logger(DenunciaImagemStorage.name);

  constructor(private readonly firebase: FirebaseService) {}

  /** Falhar ao apagar não desfaz a resolução: só registra. */
  async apagar(path: string): Promise<void> {
    try {
      await this.firebase.bucket.file(path).delete({ ignoreNotFound: true });
    } catch (e) {
      this.logger.warn(`Falha ao apagar a imagem ${path}: ${String(e)}`);
    }
  }

  async urlAssinada(path: string): Promise<string> {
    const [url] = await this.firebase.bucket.file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + DENUNCIA.URL_IMAGEM_MS,
    });
    return url;
  }
}
