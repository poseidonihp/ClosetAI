import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LogIn } from 'lucide-angular';
import { AuthStore } from '../../core/auth/auth.store';
import { BrandMarkComponent } from '../../shared/ui/brand-mark.component';
import { ErrorBannerComponent } from '../../shared/ui/error-banner.component';
import { FieldComponent } from '../../shared/ui/field.component';
import { SubmitButtonComponent } from '../../shared/ui/submit-button.component';

const defaultErrorMessage = 'No se pudo iniciar sesión';

@Component({
  selector: 'app-login',
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
  templateUrl: './login.component.html',
})
export class LoginComponent {
  protected readonly iconLogin = LogIn;
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly _formBuilder = inject(FormBuilder);
  private readonly _auth = inject(AuthStore);
  private readonly _router = inject(Router);

  protected readonly form = this._formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  /**
   * Envía las credenciales y entra al clóset si son válidas.
   * @returns {Promise<void>}
   */
  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      await this._auth.login(this.form.getRawValue());
      await this._router.navigateByUrl('/closet');
    } catch {
      this.errorMessage.set(this._auth.error() ?? defaultErrorMessage);
    } finally {
      this.submitting.set(false);
    }
  }
}
