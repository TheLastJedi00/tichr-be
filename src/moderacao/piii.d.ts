/** Tipos mínimos da `piii` (o pacote não publica os seus). */
declare module 'piii' {
  type Filtro = string | Array<string | string[] | Filtro>;

  interface OpcoesPiii {
    filters: Filtro[];
    aliases?: Record<string, string[]>;
  }

  export default class Piii {
    constructor(opcoes: OpcoesPiii);
    has(texto: string): boolean;
  }
}

declare module 'piii-filters' {
  const filtros: Record<string, Array<string | string[]>>;
  export default filtros;
}
