import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PERGUNTA } from './pergunta.constants';

/**
 * Anexo da pergunta (spec 037 #15). Privado: sem token de download público;
 * só sai por URL assinada de curta duração, gerada para o professor dono ou
 * para o aluno autor, sempre como download (`attachment`).
 */
@Injectable()
export class PerguntaAnexoStorage {
  private readonly logger = new Logger(PerguntaAnexoStorage.name);

  constructor(private readonly firebase: FirebaseService) {}

  async salvar(
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.firebase.bucket.file(path).save(buffer, {
      resumable: false,
      contentType,
      metadata: { contentDisposition: 'attachment' },
    });
  }

  /** Falhar ao apagar só gera log: o arquivo órfão não quebra a conversa. */
  async apagar(path: string): Promise<void> {
    try {
      await this.firebase.bucket.file(path).delete({ ignoreNotFound: true });
    } catch (e) {
      this.logger.warn(`Falha ao apagar o anexo ${path}: ${String(e)}`);
    }
  }

  /**
   * HTML e CSS chegam aqui como `text/plain`: mesmo aberto direto, o
   * navegador não renderiza nem roda script do arquivo.
   */
  async urlAssinada(
    path: string,
    nome: string,
    contentType: string,
  ): Promise<string> {
    const [url] = await this.firebase.bucket.file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PERGUNTA.URL_ANEXO_MS,
      responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
      responseType: contentType,
    });
    return url;
  }
}
