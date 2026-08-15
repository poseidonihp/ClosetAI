import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ShoppingBag } from 'lucide-angular';
import { PagePlaceholderComponent } from '../../shared/ui/page-placeholder.component';

@Component({
  selector: 'app-shopping-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PagePlaceholderComponent],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  template: `
    <closet-page-placeholder
      data-test="div-shopping-page"
      eyebrow="Vacíos del clóset"
      title="Qué comprar"
      emptyTitle="Nada que sugerir todavía"
      description="La Fase 5 calcula la cobertura real de tu clóset y describe qué prenda falta, cuántos looks desbloquearía y con qué marcas de referencia, según tu país y presupuesto."
      [icon]="iconBag"
    />
  `,
})
export class ShoppingPage {
  protected readonly iconBag = ShoppingBag;
}
