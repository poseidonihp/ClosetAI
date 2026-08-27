/**
 * Umbrales de "¿me lo compro?". Viven aquí y en ningún otro sitio, igual que los
 * del motor y los de la cobertura.
 */

/**
 * Bandas de formalidad en las que se agrupa la escala 1–5 para decidir si dos
 * prendas hacen el mismo papel. Se comparan bandas y no niveles porque una
 * camisa de formalidad 3 y otra de 4 son la misma compra.
 */
export const formalityBandBreakpoints: readonly number[] = [2, 3];

/** Prendas emparejadas que se le enseñan al modelo. Más no caben en tres notas. */
export const maxPairedGarmentsInEnum = 6;

/** Prefijo de los ids cortos con los que viajan las prendas emparejadas. */
export const purchaseGarmentShortIdPrefix = 'g';

/**
 * Prefijo de los ids cortos con los que viajan las brechas abiertas. Es `b` de
 * brecha y no la `h` de la Fase 5: allí son hipótesis que el motor acaba de
 * inventar para medirlas, y aquí son brechas ya guardadas y redactadas.
 */
export const purchaseGapShortIdPrefix = 'b';

/** Caracteres de la huella de la evaluación. 16 hex ya no colisionan. */
export const purchaseSignatureLength = 16;

/** Candidatas que devuelve el listado. Una lista más larga no se usa. */
export const maxListedCandidates = 40;
