import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  PlanoAtual,
  ProfessorEntity,
  StatusAssinatura,
} from './entities/professor.entity';
import { ProfessorRepository } from './professor.repository';

/** Teto do avatar ja comprimido pelo front (~50KB); a folga cobre variacao do JPEG. */
const AVATAR_MAX_BYTES = 300 * 1024;

/**
 * Perfil serializavel para o front: campos de dados + derivados da trava de
 * username (getters de classe nao aparecem no JSON, entao vao explicitos aqui).
 */
export interface ProfessorView {
  uid: string;
  nomeExibicao?: string;
  disciplina?: string;
  bio?: string;
  username?: string;
  avatarUrl?: string;
  disciplinas?: string[];
  /** Plano que vale para os gates (efetivo — cai para ESTAGIARIO se inadimplente). */
  planoAtual: PlanoAtual;
  /** Plano contratado (o que o professor paga) — para a tela de plano e o CTA de renovar. */
  planoContratado: PlanoAtual;
  /** Situacao da assinatura (ATIVA enquanto em dia; INADIMPLENTE se venceu). */
  statusAssinatura: StatusAssinatura;
  /** Vencimento da assinatura paga (ISO), se houver. */
  assinaturaAte?: string;
  slotsAdicionaisComprados: number;
  podeAlterarUsername: boolean;
  diasParaTrocarUsername: number;
  /** Se o principal autenticado tem acesso ao backoffice (flag do token). */
  isAdmin: boolean;
}

@Injectable()
export class ProfessorService {
  constructor(
    private readonly repo: ProfessorRepository,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Sobe a foto de perfil via Admin SDK e persiste a URL no perfil. O upload
   * passa a ser server-side: o cliente nao tem sessao do Firebase Auth, entao o
   * Storage nega escrita anonima — quem grava e o backend, dono das credenciais.
   * Retorna a view atualizada (o front ja recebe o avatarUrl novo).
   */
  async uploadAvatar(
    uid: string,
    arquivo?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<ProfessorView> {
    if (!arquivo) {
      throw new BadRequestException('Arquivo de imagem ausente.');
    }
    if (!arquivo.mimetype.startsWith('image/')) {
      throw new BadRequestException('O arquivo precisa ser uma imagem.');
    }
    if (arquivo.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('Imagem muito grande (maximo 300KB).');
    }

    const caminho = `avatars/${uid}.jpg`;
    // Token de download aleatorio: reproduz o formato de URL publica que o SDK web
    // gerava, sem depender das storage.rules (que negam leitura fora deste fluxo).
    const token = randomUUID();
    const blob = this.firebase.bucket.file(caminho);
    await blob.save(arquivo.buffer, {
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });

    const bucketName = this.firebase.bucket.name;
    const avatarUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
      `${encodeURIComponent(caminho)}?alt=media&token=${token}`;

    await this.repo.upsert(uid, { avatarUrl });
    return ProfessorService.montarView(await this.getProfile(uid));
  }

  /** Retorna o perfil do professor, ou um perfil vazio (so uid) se ainda nao existir. */
  async getProfile(uid: string): Promise<ProfessorEntity> {
    return (await this.repo.findByUid(uid)) ?? new ProfessorEntity({ uid });
  }

  /** Monta a "view" serializavel do perfil (campos + derivados da trava). */
  static montarView(p: ProfessorEntity): ProfessorView {
    return {
      uid: p.uid,
      nomeExibicao: p.nomeExibicao,
      disciplina: p.disciplina,
      bio: p.bio,
      username: p.username,
      avatarUrl: p.avatarUrl,
      disciplinas: p.disciplinas,
      // planoAtual da view = plano EFETIVO: os gates do front (limites, recursos)
      // ja respeitam a inadimplencia sem conhecer a regra. O contratado vai a parte.
      planoAtual: p.planoEfetivo(),
      planoContratado: p.planoAtual,
      statusAssinatura: p.statusDerivado(),
      assinaturaAte: p.assinaturaAte,
      slotsAdicionaisComprados: p.slotsAdicionaisComprados ?? 0,
      podeAlterarUsername: p.podeAlterarUsername(),
      diasParaTrocarUsername: p.diasParaTrocarUsername(),
      // Admin vem do proprio documento (fonte de verdade no Firestore).
      isAdmin: p.isAdmin ?? false,
    };
  }

  /** Perfil do professor ja no formato de view (para os controllers). */
  async getProfileView(uid: string): Promise<ProfessorView> {
    return ProfessorService.montarView(await this.getProfile(uid));
  }

  /** Normaliza o handle: remove '@' inicial e baixa a caixa. */
  static normalizarUsername(raw: string): string {
    return raw.trim().replace(/^@/, '').toLowerCase();
  }

  /** Professor dono de um @username (normalizado), ou null. */
  findByUsername(raw: string): Promise<ProfessorEntity | null> {
    return this.repo.findByUsername(ProfessorService.normalizarUsername(raw));
  }

  /** Disponibilidade de um username (livre ou ja pertence ao proprio professor). */
  async checkUsername(
    uid: string,
    raw: string,
  ): Promise<{ username: string; disponivel: boolean }> {
    const username = ProfessorService.normalizarUsername(raw);
    const dono = await this.repo.findByUsername(username);
    return { username, disponivel: !dono || dono.uid === uid };
  }

  async updateProfile(
    uid: string,
    dto: UpdateProfileDto,
  ): Promise<ProfessorEntity> {
    const dados: Partial<ProfessorEntity> = { ...dto };
    if (dto.username !== undefined) {
      const username = ProfessorService.normalizarUsername(dto.username);
      const atual = (await this.repo.findByUid(uid)) ?? new ProfessorEntity({ uid });
      const mudou = (atual.username ?? '') !== username;

      if (mudou) {
        // Trava de identificador: so troca a cada 60 dias.
        const dias = atual.diasParaTrocarUsername();
        if (dias > 0) {
          throw new ConflictException({
            code: 'USERNAME_COOLDOWN',
            diasRestantes: dias,
            message: `Voce podera alterar seu nome de usuario novamente em ${dias} dias.`,
          });
        }
        // Unicidade do handle (so quando muda de fato).
        const dono = await this.repo.findByUsername(username);
        if (dono && dono.uid !== uid) {
          throw new ConflictException('Esse @username ja esta em uso.');
        }
        dados.lastUsernameChange = new Date().toISOString();
      }
      dados.username = username;
    }
    return this.repo.upsert(uid, dados);
  }

  /** Compra uma vaga avulsa: incrementa slotsAdicionaisComprados em +1. */
  async comprarSlotAvulso(uid: string): Promise<ProfessorEntity> {
    const atual = await this.getProfile(uid);
    return this.repo.upsert(uid, {
      slotsAdicionaisComprados: (atual.slotsAdicionaisComprados ?? 0) + 1,
    });
  }

  /** Faz upgrade/downgrade do nivel academico do professor. */
  async alterarPlano(uid: string, plano: PlanoAtual): Promise<ProfessorEntity> {
    return this.repo.upsert(uid, { planoAtual: plano });
  }

  /** Registra o id da cobranca aberta no gateway (para reconciliacao/polling). */
  async registrarBillingAtual(uid: string, billingId: string): Promise<void> {
    await this.repo.upsert(uid, { billingIdAtual: billingId });
  }

  /** Registra o uso da IA do Tichr Wor agora (base do rate limit diario). */
  async marcarUsoIaWor(uid: string): Promise<void> {
    await this.repo.upsert(uid, { worIaUltimoUso: new Date().toISOString() });
  }

  /** Registra o uso da IA do Tichr Qlick agora (rate limit diario, separado do Wor). */
  async marcarUsoIaQlick(uid: string): Promise<void> {
    await this.repo.upsert(uid, { qlickIaUltimoUso: new Date().toISOString() });
  }

  /** Registra o uso da IA do Tichr Isolateus agora (rate limit diario, contador proprio). */
  async marcarUsoIaIsolateus(uid: string): Promise<void> {
    await this.repo.upsert(uid, {
      isolateusIaUltimoUso: new Date().toISOString(),
    });
  }
}
