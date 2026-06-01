const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface VinDecodeResult {
  year: number;
  make: string;
  model: string;
  trim: string | null;
}

/** Decode a VIN via NHTSA vPIC (browser → NHTSA; not billed on our API). */
export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const normalized = vin.trim().toUpperCase();
  if (!VIN_REGEX.test(normalized)) {
    throw new Error('Invalid VIN format');
  }
  const r = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${normalized}?format=json`,
  );
  const data = await r.json();
  const get = (k: string) =>
    data?.Results?.find((x: { Variable?: string; Value?: string }) => x.Variable === k)?.Value ?? null;
  const year = get('Model Year');
  const make = get('Make');
  const model = get('Model');
  if (!year || !make || !model) {
    throw new Error('VIN could not be decoded');
  }
  return {
    year: parseInt(String(year), 10),
    make: String(make).toUpperCase(),
    model: String(model).toUpperCase(),
    trim: get('Trim') != null ? String(get('Trim')) : null,
  };
}
