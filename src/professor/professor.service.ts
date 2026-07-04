import { ConflictException, Injectable } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PlanoAtual, ProfessorEntity } from './entities/professor.entity';
import { ProfessorRepository } from './professor.repository';

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
  planoAtual: PlanoAtual;
  slotsAdicionaisComprados: number;
  podeAlterarUsername: boolean;
  diasParaTrocarUsername: number;
}

@Injectable()
export class ProfessorService {
  constructor(private readonly repo: ProfessorRepository) {}

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
      planoAtual: p.planoAtual,
      slotsAdicionaisComprados: p.slotsAdicionaisComprados ?? 0,
      podeAlterarUsername: p.podeAlterarUsername(),
      diasParaTrocarUsername: p.diasParaTrocarUsername(),
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
}
