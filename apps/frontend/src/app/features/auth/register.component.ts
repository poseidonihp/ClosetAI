import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UserPlus } from 'lucide-angular';
import { passwordMinLength } from '@closetai/shared-types';
import { AuthStore } from '../../core/auth/auth.store';
import { BrandMarkComponent } from '../../shared/ui/brand-mark.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { FieldComponent } from '../../shared/ui/field.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';

const maxDisplayNameLength = 80;
const defaultErrorMessage = 'No se pudo crear la cuenta';

@Component({
  selector: 'app-register',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BrandMarkComponent,
    ErrorBannerComponent,
    FieldComponent,
    SubmitButtonComponent,
  ],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  protected readonly iconRegister = UserPlus;
  protected readonly passwordMinLength = passwordMinLength;
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly _formBuilder = inject(FormBuilder);
  private readonly _auth = inject(AuthStore);
  private readonly _router = inject(Router);

  protected readonly form = this._formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(maxDisplayNameLength)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(passwordMinLength)]],
  });

  /**
   * Crea la cuenta y entra directamente al clóset.
   * @returns {Promise<void>}
   */
  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      await this._auth.register(this.form.getRawValue());
      await this._router.navigateByUrl('/closet');
    } catch {
      this.errorMessage.set(this._auth.error() ?? defaultErrorMessage);
    } finally {
      this.submitting.set(false);
    }
  }
}
