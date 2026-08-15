import {
  climateReferenceTempC,
  colorFamilyFromHex,
  type Climate,
  type ColorFamily,
  type Garment,
  type GarmentStatus,
} from '@closetai/shared-types';

/**
 * Filtros del clóset como código puro, fuera del componente: así se pueden
 * probar sin montar Angular y la página se limita a mantener los signals.
 *
 * Cada filtro vacío significa "cualquiera", nunca "ninguno": el clóset completo
 * es el estado por defecto.
 */
export interface IClosetFilters {
  search: string;
  slots: readonly string[];
  colorFamily: ColorFamily | '';
  climate: Climate | '';
  status: GarmentStatus | '';
}

export const emptyClosetFilters: IClosetFilters = {
  search: '',
  slots: [],
  colorFamily: '',
  climate: '',
  status: '',
};

/**
 * Indica si hay algún filtro activo, para mostrar el contador y el botón de
 * limpiar sólo cuando sirven de algo.
 * @param {IClosetFilters} filters - Filtros actuales.
 * @returns {boolean}
 */
export function hasActiveFilters(filters: IClosetFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.slots.length > 0 ||
    filters.colorFamily !== '' ||
    filters.climate !== '' ||
    filters.status !== ''
  );
}

/**
 * Aplica todos los filtros a una prenda.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {IClosetFilters} filters - Filtros actuales.
 * @returns {boolean}
 */
export function matchesFilters(garment: Garment, filters: IClosetFilters): boolean {
  return (
    matchesSearch(garment, filters.search) &&
    matchesSlot(garment, filters.slots) &&
    matchesColor(garment, filters.colorFamily) &&
    matchesClimate(garment, filters.climate) &&
    matchesStatus(garment, filters.status)
  );
}

/**
 * Busca el texto en nombre, tipo, marca y nombre de color.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {string} search - Texto buscado.
 * @returns {boolean}
 */
function matchesSearch(garment: Garment, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }
  const haystack = [
    garment.name,
    garment.garmentTypeName,
    garment.brand ?? '',
    garment.primaryColorName,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

/**
 * Comprueba el filtro de slot.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {readonly string[]} slots - Slots seleccionados.
 * @returns {boolean}
 */
function matchesSlot(garment: Garment, slots: readonly string[]): boolean {
  return slots.length === 0 || slots.includes(garment.slot);
}

/**
 * Comprueba el filtro de familia de color, derivada del hex principal.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {ColorFamily | ''} family - Familia seleccionada.
 * @returns {boolean}
 */
function matchesColor(garment: Garment, family: ColorFamily | ''): boolean {
  return family === '' || colorFamilyFromHex(garment.primaryColorHex) === family;
}

/**
 * Comprueba si la prenda es cómoda a la temperatura de referencia del clima.
 * Una prenda sin rango declarado no se descarta: no hay dato que la contradiga.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {Climate | ''} climate - Clima seleccionado.
 * @returns {boolean}
 */
function matchesClimate(garment: Garment, climate: Climate | ''): boolean {
  if (climate === '') {
    return true;
  }
  const referenceTempC = climateReferenceTempC[climate];
  if (referenceTempC === null) {
    return true;
  }
  const aboveMin = garment.weatherMinC === null || referenceTempC >= garment.weatherMinC;
  const belowMax = garment.weatherMaxC === null || referenceTempC <= garment.weatherMaxC;
  return aboveMin && belowMax;
}

/**
 * Comprueba el filtro de estado.
 * @param {Garment} garment - Prenda a evaluar.
 * @param {GarmentStatus | ''} status - Estado seleccionado.
 * @returns {boolean}
 */
function matchesStatus(garment: Garment, status: GarmentStatus | ''): boolean {
  return status === '' || garment.status === status;
}
