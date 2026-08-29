import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  Camera,
  Check,
  LucideAngularModule,
  RefreshCw,
  RotateCcw,
  SwitchCamera,
  X,
} from 'lucide-angular';
import {
  cameraErrorMessage,
  captureFileName,
  captureMimeType,
  captureQuality,
  fallbackCaptureMimeType,
  fitWithin,
  isCameraAvailable,
  maxCaptureEdgePx,
} from './camera';

/** Resolución que se le pide a la cámara. Es una preferencia, no una exigencia. */
const idealCaptureWidthPx = 1920;
/** Cámara trasera cuando el dispositivo tiene varias: la ropa está delante de ti. */
const preferredFacingMode = 'environment';
const encodingFailedMessage = 'El navegador no pudo guardar la foto. Vuelve a intentarlo.';
/** Con una sola cámara no hay a qué cambiar. */
const minimumCamerasToSwitch = 2;

/** Foto ya tomada, pendiente de que el usuario la acepte o la repita. */
interface ICapturedShot {
  file: File;
  previewUrl: string;
}

/**
 * Captura una foto con la cámara del dispositivo y la devuelve como `File`, listo
 * para la misma cola de subida que una foto elegida del disco.
 * @class
 */
@Component({
  selector: 'closet-camera-capture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: {
    '(document:keydown.escape)': 'close()',
  },
  templateUrl: './camera-capture.component.html',
  styleUrl: './camera-capture.component.scss',
})
export class CameraCaptureComponent implements OnInit, OnDestroy {
  /** La foto aceptada por el usuario. */
  readonly captured = output<File>();
  readonly closed = output();

  protected readonly iconCamera = Camera;
  protected readonly iconCheck = Check;
  protected readonly iconClose = X;
  protected readonly iconRetake = RotateCcw;
  protected readonly iconRetry = RefreshCw;
  protected readonly iconSwitch = SwitchCamera;

  private readonly _videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  /** Stream activo. Es signal para que el efecto lo cuelgue del `<video>`. */
  private readonly _stream = signal<MediaStream | null>(null);
  private _deviceIds: readonly string[] = [];
  private _deviceIndex = 0;

  protected readonly starting = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly shot = signal<ICapturedShot | null>(null);
  protected readonly mirrored = signal(false);
  /** Cuántas cámaras ve el navegador: con una sola no se ofrece cambiar. */
  protected readonly cameraCount = signal(0);

  /**
   * Cuelga el stream del `<video>` en cuanto existen los dos. El elemento se
   * desmonta al tomar la foto y vuelve al repetirla, así que el efecto se
   * reevalúa solo.
   * @constructor
   */
  constructor() {
    effect(() => {
      const video = this._videoRef()?.nativeElement;
      const stream = this._stream();
      if (!video || !stream) {
        return;
      }
      video.srcObject = stream;
      void video.play().catch(() => {
        // Un play() rechazado no rompe nada: el primer fotograma ya está pintado.
      });
    });
  }

  /**
   * Pide la cámara al montar el componente.
   * @returns {void}
   */
  ngOnInit(): void {
    void this.start();
  }

  /**
   * Suelta la cámara y el objeto de la vista previa.
   * @returns {void}
   */
  ngOnDestroy(): void {
    this._release();
  }

  /**
   * Abre la cámara pedida, o la preferida si no se indica ninguna.
   * @param {string} [deviceId] - Cámara concreta a abrir.
   * @returns {Promise<void>}
   */
  protected async start(deviceId?: string): Promise<void> {
    this.error.set(null);
    this.starting.set(true);
    if (!isCameraAvailable()) {
      this.error.set(cameraErrorMessage(null));
      this.starting.set(false);
      return;
    }

    this._stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: idealCaptureWidthPx } }
          : {
              facingMode: { ideal: preferredFacingMode },
              width: { ideal: idealCaptureWidthPx },
            },
      });
      this._stream.set(stream);
      this.mirrored.set(CameraCaptureComponent._facesUser(stream));
      await this._readDevices();
    } catch (error: unknown) {
      this.error.set(cameraErrorMessage(error));
    } finally {
      this.starting.set(false);
    }
  }

  /**
   * Congela el fotograma actual como archivo. El `<video>` se desmonta pero el
   * stream sigue vivo, así que repetir la foto es inmediato.
   * @returns {Promise<void>}
   */
  protected async takePhoto(): Promise<void> {
    const video = this._videoRef()?.nativeElement;
    if (!video) {
      return;
    }
    const size = fitWithin(video.videoWidth, video.videoHeight, maxCaptureEdgePx);
    if (size.width === 0) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      this.error.set(encodingFailedMessage);
      return;
    }
    context.drawImage(video, 0, 0, size.width, size.height);

    const encoded = await CameraCaptureComponent._encode(canvas);
    if (!encoded) {
      this.error.set(encodingFailedMessage);
      return;
    }
    const file = new File([encoded], captureFileName(new Date(), encoded.type), {
      type: encoded.type,
    });
    this.shot.set({ file, previewUrl: URL.createObjectURL(file) });
  }

  /**
   * Descarta la foto tomada y vuelve a la vista en vivo.
   * @returns {void}
   */
  protected retake(): void {
    this._revokePreview();
    this.shot.set(null);
  }

  /**
   * Acepta la foto y cierra: quien abrió la cámara la mete en su cola de subida.
   * @returns {void}
   */
  protected usePhoto(): void {
    const shot = this.shot();
    if (!shot) {
      return;
    }
    this.captured.emit(shot.file);
    this._revokePreview();
    this.shot.set(null);
    this.close();
  }

  /**
   * Pasa a la siguiente cámara del dispositivo.
   * @returns {void}
   */
  protected switchCamera(): void {
    if (this._deviceIds.length < minimumCamerasToSwitch) {
      return;
    }
    this._deviceIndex = (this._deviceIndex + 1) % this._deviceIds.length;
    void this.start(this._deviceIds[this._deviceIndex]);
  }

  /**
   * Suelta la cámara y cierra el capturador.
   * @returns {void}
   */
  protected close(): void {
    this._release();
    this.closed.emit();
  }

  /**
   * Lista las cámaras disponibles. Sólo tiene sentido después del permiso: antes
   * el navegador devuelve entradas sin etiqueta ni identificador.
   * @private
   * @returns {Promise<void>}
   */
  private async _readDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
      this._deviceIds = cameras.map(camera => camera.deviceId);
      this.cameraCount.set(cameras.length);
      const activeId = this._stream()?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
      const activeIndex = this._deviceIds.indexOf(activeId);
      this._deviceIndex = activeIndex >= 0 ? activeIndex : 0;
    } catch {
      // Sin lista de cámaras se pierde el botón de cambiar, no la captura.
      this.cameraCount.set(0);
    }
  }

  /**
   * Corta la cámara y libera la vista previa.
   * @private
   * @returns {void}
   */
  private _release(): void {
    this._stopStream();
    this._revokePreview();
  }

  /**
   * Apaga las pistas del stream. Sin esto el piloto de la cámara se queda
   * encendido después de cerrar.
   * @private
   * @returns {void}
   */
  private _stopStream(): void {
    for (const track of this._stream()?.getTracks() ?? []) {
      track.stop();
    }
    this._stream.set(null);
  }

  /**
   * Libera el objeto de la vista previa, que ocupa memoria hasta que se revoca.
   * @private
   * @returns {void}
   */
  private _revokePreview(): void {
    const shot = this.shot();
    if (shot) {
      URL.revokeObjectURL(shot.previewUrl);
    }
  }

  /**
   * Indica si la cámara activa apunta al usuario. Una webcam de escritorio no
   * declara `facingMode`, y ésas también se ven al revés sin espejo.
   * @private
   * @param {MediaStream} stream - Stream recién abierto.
   * @returns {boolean}
   */
  private static _facesUser(stream: MediaStream): boolean {
    const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
    return facingMode !== preferredFacingMode;
  }

  /**
   * Codifica el lienzo, con JPEG de respaldo para un navegador sin WebP.
   * @private
   * @param {HTMLCanvasElement} canvas - Lienzo con el fotograma ya dibujado.
   * @returns {Promise<Blob | null>}
   */
  private static async _encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
    const webp = await CameraCaptureComponent._toBlob(canvas, captureMimeType);
    if (webp && webp.type === captureMimeType) {
      return webp;
    }
    return CameraCaptureComponent._toBlob(canvas, fallbackCaptureMimeType);
  }

  /**
   * Promisifica `canvas.toBlob`.
   * @private
   * @param {HTMLCanvasElement} canvas - Lienzo ya dibujado.
   * @param {string} mimeType - Formato pedido.
   * @returns {Promise<Blob | null>}
   */
  private static _toBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), mimeType, captureQuality);
    });
  }
}
