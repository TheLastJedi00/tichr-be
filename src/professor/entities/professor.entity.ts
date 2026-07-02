/**
 * Perfil do professor. Documento salvo em `professores/{uid}`
 * (o uid do Firebase Auth e a chave do documento).
 */
export class ProfessorEntity {
  uid: string;
  nomeExibicao?: string;
  disciplina?: string;
  bio?: string;

  constructor(partial: Partial<ProfessorEntity> = {}) {
    Object.assign(this, partial);
  }

  get temNome(): boolean {
    return !!this.nomeExibicao && this.nomeExibicao.trim().length > 0;
  }
}
