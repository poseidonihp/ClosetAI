import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LucideAngularModule, Download } from 'lucide-angular';
import { PwaService } from './pwa.service';

/**
 * Botón de instalación de la PWA. Se esconde solo cuando el navegador no la
 * ofrece —porque ya está instalada, porque no cumple los criterios o porque el
 * navegador no lo soporta—, así que el llamante no necesita su propio `@if`.
 */
@Component({
  selector: 'app-install-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: {
    '[style.display]': "pwa.canInstall() ? 'contents' : 'none'",
  },
  template: `
    @if (pwa.canInstall()) {
      @if (compact()) {
        <button
          type="button"
          class="icon-btn h-9 w-9"
          data-test="action-install-panel"
          aria-label="Instalar closetAI"
          title="Instalar closetAI"
          (click)="install()"
        >
          <lucide-icon [name]="iconDownload" class="h-4 w-4" aria-hidden="true" />
        </button>
      } @else {
        <button type="button" class="pill" data-test="action-install-page" (click)="install()">
          <lucide-icon [name]="iconDownload" class="h-3.5 w-3.5" aria-hidden="true" />
          Instalar la app
        </button>
      }
    }
  `,
})
export class InstallButtonComponent {
  /** Sólo el icono, para las barras donde no cabe una etiqueta. */
  readonly compact = input(false);

  protected readonly pwa = inject(PwaService);
  protected readonly iconDownload = Download;

  /**
   * Abre el diálogo de instalación del navegador.
   * @returns {void}
   */
  protected install(): void {
    void this.pwa.install();
  }
}
