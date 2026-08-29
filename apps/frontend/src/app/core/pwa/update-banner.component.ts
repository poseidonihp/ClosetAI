import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PwaService } from './pwa.service';

/**
 * Aviso de versión nueva. Va montado en la raíz porque un despliegue nuevo
 * importa en cualquier ruta, y no se auto-recarga: recargar en medio de un
 * formulario a medio escribir perdería lo escrito.
 */
@Component({
  selector: 'app-update-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pwa.updateReady()) {
      <div class="update-banner" role="status" data-test="div-update-page">
        <span>Hay una versión nueva de closetAI.</span>
        <button
          type="button"
          class="pill pill-solid"
          data-test="action-update-page"
          (click)="pwa.applyUpdate()"
        >
          Actualizar
        </button>
      </div>
    }
  `,
  styles: `
    .update-banner {
      position: fixed;
      left: 50%;
      bottom: 16px;
      z-index: 60;
      display: flex;
      align-items: center;
      gap: 12px;
      transform: translateX(-50%);
      padding: 10px 12px 10px 16px;
      border-radius: 999px;
      font-size: 12px;
      color: var(--qp-ink);
      background: var(--qp-bg-soft);
      border: 1px solid var(--qp-line-strong);
      box-shadow: 0 12px 32px rgba(26, 24, 21, 0.18);
    }

    @media (max-width: 639px) {
      .update-banner {
        /* Por encima de la navegación inferior, que ocupa la franja de abajo. */
        bottom: 76px;
      }
    }
  `,
})
export class UpdateBannerComponent {
  protected readonly pwa = inject(PwaService);
}
