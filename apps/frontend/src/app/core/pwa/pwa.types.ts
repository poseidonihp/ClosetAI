/**
 * Contratos del evento de instalación. Es una extensión propietaria de Chromium
 * que no está en la librería DOM de TypeScript, así que se declara aquí en vez
 * de degradar el tipo del listener a `any`.
 */

/** Resultado de la decisión del usuario ante el diálogo de instalación. */
export interface IInstallChoice {
  outcome: 'accepted' | 'dismissed';
  platform: string;
}

/**
 * Evento que Chromium dispara cuando la app cumple los criterios de instalación.
 * Guardarlo es la única forma de ofrecer el botón cuando el usuario quiera y no
 * cuando el navegador decida.
 */
export interface IBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<IInstallChoice>;
}
