/**
 * Bancos estáticos do Tichr Isolateus: os 6 setores da vila, os pseudônimos dos
 * Habitantes Virtuais (NPCs) e as frases genéricas que alimentam o Chat de
 * Rumores e o debate da Quarentena.
 *
 * As frases são estáticas de propósito: chamar a IA a cada rodada multiplicaria
 * custo e latência e furaria o rate limit de 1×/dia. A IA fica exclusiva da
 * geração das questões (o conteúdo pedagógico, que é o que vale XP).
 */

/** Os 6 setores vitais da vila (§8: o total de 6 é a base do critério de vitória). */
export const SETORES: Array<{ id: string; nome: string }> = [
  { id: 'seguranca', nome: 'Setor de Segurança' },
  { id: 'comercio', nome: 'Setor de Comércio' },
  { id: 'medico', nome: 'Setor Médico' },
  { id: 'energia', nome: 'Setor de Energia' },
  { id: 'comunicacao', nome: 'Setor de Comunicação' },
  { id: 'abastecimento', nome: 'Setor de Abastecimento' },
];

/** Pseudônimos dos Habitantes Virtuais — a Névoa de Guerra que camufla a Ameaça. */
export const NOMES_NPC: string[] = [
  'Corvo Pálido',
  'Velha Ingrid',
  'Ferreiro Kolt',
  'Menina do Farol',
  'Caçador Ruvik',
  'Irmã Neve',
  'Lenhador Bran',
  'Vigia Torvald',
  'Curandeira Ysolde',
  'Pescador Halvar',
  'Andarilho Sem Nome',
  'Guarda Astrid',
  'Sineiro Egil',
  'Tecelã Runa',
  'Ermitão da Encosta',
  'Órfão da Neve',
  'Barqueiro Sten',
  'Boticária Freya',
];

/** Ruído de fundo do Chat de Rumores durante a defesa de um setor. */
export const FRASES_NPC: string[] = [
  'Ouvi passos no telhado ontem à noite. Ninguém acredita em mim.',
  'As luzes voltaram a piscar sobre a floresta.',
  'Precisamos decidir rápido, o frio não espera.',
  'Alguém aqui não está sendo honesto.',
  'Eu vi alguém saindo da vila depois do toque de recolher.',
  'Não confio em quem fala demais.',
  'Fiquem calmos. O pânico é o que eles querem.',
  'Meu cão não para de latir para a mata.',
  'Se errarmos de novo, não sobra vila para salvar.',
  'Tem pegada estranha perto do rio congelado.',
  'Prefiro ficar calado. Falar chama atenção.',
  'Alguém mexeu nos meus mantimentos.',
  'A resposta parece óbvia demais. Cuidado.',
  'Eu durmo de olhos abertos desde terça.',
  'Não fui eu. Juro pela minha família.',
  'O silêncio lá fora está pior que o barulho.',
];

/** Frases curtas de acusação/defesa dos NPCs na Quarentena. */
export const FRASES_DEBATE_NPC: string[] = [
  'Ele mudou de ideia rápido demais na última votação.',
  'Estou vendo gente concordar com qualquer coisa.',
  'Não votem em mim. Eu defendi o setor.',
  'Quem espalhou aquele rumor devia explicar.',
  'Prefiro trancar alguém a perder mais uma noite.',
  'Isso é uma armadilha. Vão errar de novo.',
  'Eu confio em quem argumentou com lógica.',
  'Alguém aqui sabia a resposta e escondeu.',
];

/** Sorteia `n` nomes de NPC sem repetir (e sem colidir com os nomes já usados). */
export function sortearNomesNpc(n: number, usados: string[]): string[] {
  const tomados = new Set(usados.map((u) => u.trim().toLowerCase()));
  const livres = NOMES_NPC.filter((nome) => !tomados.has(nome.toLowerCase()));
  const escolhidos: string[] = [];
  for (let i = 0; i < n; i++) {
    const nome = livres[i % livres.length];
    // Se a vila for maior que o banco, sufixa para manter o nome único.
    escolhidos.push(i < livres.length ? nome : `${nome} (o Jovem)`);
  }
  return escolhidos;
}
