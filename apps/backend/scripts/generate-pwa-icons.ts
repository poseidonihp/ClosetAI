/**
 * Genera los iconos PNG de la PWA a partir de `apps/frontend/public/favicon.svg`,
 * que es la única fuente del logotipo. Vive en el backend porque `sharp` vive
 * aquí: añadirlo al frontend sólo para este script duplicaría un binario nativo
 * que ya está instalado. Se corre a mano cuando cambia la marca:
 *   pnpm --filter @closetai/backend gen:icons
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** Fondo del logotipo. Es el mismo `#1a1815` del `rect` de `favicon.svg`. */
const brandBackgroundColor = '#1a1815';
/** Densidad de rasterizado del SVG: por debajo de esto los trazos salen borrosos. */
const svgRenderDensity = 512;
const iconSizePx = { small: 192, large: 512, apple: 180 } as const;
/**
 * Un icono `maskable` se recorta con una máscara desconocida (círculo, gota,
 * cuadrado redondeado) y sólo el 80 % central está garantizado. El logotipo se
 * compone a esa fracción sobre un fondo a sangre del mismo color, así que las
 * esquinas redondeadas del SVG quedan invisibles y nada del trazo se pierde.
 */
const maskableSafeAreaRatio = 0.8;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendPublicDirectory = resolve(scriptDirectory, '../../frontend/public');
const sourceSvgPath = join(frontendPublicDirectory, 'favicon.svg');
const iconsDirectory = join(frontendPublicDirectory, 'icons');

/**
 * Rasteriza el logotipo al tamaño pedido conservando la transparencia.
 * @param {Buffer} svg - Contenido del SVG de origen.
 * @param {number} sizePx - Lado del PNG resultante.
 * @returns {Promise<Buffer>}
 */
async function renderLogo(svg: Buffer, sizePx: number): Promise<Buffer> {
  return sharp(svg, { density: svgRenderDensity }).resize(sizePx, sizePx).png().toBuffer();
}

/**
 * Compone el logotipo centrado sobre un lienzo opaco del color de marca.
 * @param {Buffer} logo - Logotipo ya rasterizado.
 * @param {number} logoSizePx - Lado del logotipo compuesto.
 * @param {number} canvasSizePx - Lado del lienzo final.
 * @returns {Promise<Buffer>}
 */
async function composeOnBrandCanvas(
  logo: Buffer,
  logoSizePx: number,
  canvasSizePx: number,
): Promise<Buffer> {
  const offset = Math.round((canvasSizePx - logoSizePx) / 2);
  return sharp({
    create: {
      width: canvasSizePx,
      height: canvasSizePx,
      channels: 4,
      background: brandBackgroundColor,
    },
  })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toBuffer();
}

/**
 * Escribe los cuatro iconos que declara el manifest.
 * @returns {Promise<void>}
 */
async function generateIcons(): Promise<void> {
  const svg = await readFile(sourceSvgPath);
  await mkdir(iconsDirectory, { recursive: true });

  const maskableLogoSize = Math.round(iconSizePx.large * maskableSafeAreaRatio);
  const [small, large, maskableLogo, appleLogo] = await Promise.all([
    renderLogo(svg, iconSizePx.small),
    renderLogo(svg, iconSizePx.large),
    renderLogo(svg, maskableLogoSize),
    renderLogo(svg, iconSizePx.apple),
  ]);

  const [maskable, apple] = await Promise.all([
    composeOnBrandCanvas(maskableLogo, maskableLogoSize, iconSizePx.large),
    // iOS ignora la transparencia y pinta el fondo que le dé la gana detrás.
    composeOnBrandCanvas(appleLogo, iconSizePx.apple, iconSizePx.apple),
  ]);

  const written: readonly [string, Buffer][] = [
    ['icon-192.png', small],
    ['icon-512.png', large],
    ['icon-maskable-512.png', maskable],
    ['apple-touch-icon.png', apple],
  ];
  for (const [name, content] of written) {
    await writeFile(join(iconsDirectory, name), content);
  }
  console.warn(`generateIcons - ${written.length} iconos escritos en ${iconsDirectory}`);
}

generateIcons().catch((error: unknown) => {
  console.error(
    'generateIcons - no se pudieron generar los iconos',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
