import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackRepository } from './feedback.repository';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly repo: FeedbackRepository,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Quem e o professor, segundo o servidor. O nome vive no Firestore e o e-mail
   * so no Firebase Auth, entao sao duas leituras — feitas em paralelo porque
   * nenhuma depende da outra.
   *
   * Nenhuma das duas e obrigatoria: um professor sem `nomeExibicao` (ou cuja
   * conta perdeu o e-mail) ainda tem direito de reclamar. Falha aqui degrada o
   * cabecalho do relato, nunca o relato.
   */
  private async identificar(
    uid: string,
  ): Promise<{ nome: string; email: string }> {
    const [doc, user] = await Promise.all([
      this.firebase.firestore.collection('professores').doc(uid).get(),
      this.firebase.auth.getUser(uid).catch(() => null),
    ]);
    const nome = (doc.data()?.nomeExibicao as string | undefined) ?? '';
    return { nome, email: user?.email ?? '' };
  }

  async criar(uid: string, dto: CreateFeedbackDto): Promise<FeedbackEntity> {
    const { nome, email } = await this.identificar(uid);

    return this.repo.create(
      new FeedbackEntity({
        professorId: uid,
        professorNome: nome,
        professorEmail: email,
        categoria: dto.categoria,
        mensagem: dto.mensagem.trim(),
        rota: dto.rota,
        userAgent: dto.userAgent,
        status: 'PENDENTE',
        criadoEm: new Date().toISOString(),
      }),
    );
  }
}
