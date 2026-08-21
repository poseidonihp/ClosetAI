import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Bookmark } from 'lucide-angular';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ProfileStore } from '../profile/profile.store';
import { OutfitListComponent } from './outfit-list.component';
import { SavedOutfitsStore } from './saved-outfits.store';

const skeletonCards = 2;

/**
 * Página de looks guardados: la ficha completa de cada look que marcaste.
 * @class
 */
@Component({
  selector: 'app-saved-looks-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    ErrorBannerComponent,
    OutfitListComponent,
    SkeletonComponent,
  ],
  host: { style: 'display: flex; flex: 1; flex-direction: column' },
  templateUrl: './saved-looks.page.html',
  styleUrl: './saved-looks.page.scss',
})
export class SavedLooksPage implements OnInit {
  protected readonly iconBookmark = Bookmark;
  protected readonly skeletonCards = Array.from({ length: skeletonCards }, (_unused, i) => i);

  /** Público porque la lista de fichas lo recibe como entrada. */
  protected readonly savedStore = inject(SavedOutfitsStore);
  private readonly _profile = inject(ProfileStore);

  protected readonly outfits = this.savedStore.outfits;
  protected readonly loading = this.savedStore.loading;
  protected readonly loaded = this.savedStore.loaded;
  protected readonly error = this.savedStore.error;

  /** Altura declarada en el perfil; la ficha la cita sólo si existe. */
  protected readonly heightCm = computed(() => this._profile.profile()?.heightCm ?? null);

  /**
   * Recarga los guardados al entrar: pueden haber cambiado desde otra pantalla
   * —o desde otro dispositivo— y la lista tiene que decir la verdad.
   * @returns {void}
   */
  ngOnInit(): void {
    void this.savedStore.load();
    void this._profile.load();
  }
}
