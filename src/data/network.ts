/**
 * Canonical reference network for trip-service — the single source of truth for
 * the operator, stops, buses, routes and fares the service needs to function.
 *
 * Everything that seeds these tables derives from this file:
 *   - loaders/bootstrap.ts   idempotently upserts it on every startup
 *   - scripts/seed-network.ts (dev only) resets the DB, calls bootstrap, then
 *                             generates random future trips on top
 *
 * Stops are reference geography; the routes/fares/buses belong to the flagship
 * demo operator (Volcano Express, same id as its user-service org so tickets and
 * wallet line up). Fares are the RURA INTERCITY 2026 tariff (RWF, integer).
 */

// Volcano Express — same id as the user-service org.
export const ORG = {
  id: 'c7851517-492f-4dfc-bf63-41263bcc7c8a',
  name: 'Volcano Express',
  slug: 'volcano-express',
  tin: '102000300',
};

// name -> [lat, lng]. Long-decimal coords are the real ones provided.
export const STOPS: Record<string, [number, number]> = {
  Agatunda: [-2.5897, 29.7089], Akanyaru: [-2.85, 29.75], Base: [-1.6678841, 29.8407537],
  Batima: [-2.2167, 30.05], Birambo: [-2.1667, 29.3833], Brasserie: [-1.68, 29.23],
  Bugaragara: [-1.5167, 30.5333], Bugeshi: [-1.65, 29.1], Buguma: [-1.7833, 30.1333],
  Buhabwa: [-2.1333, 30.65], Buhanda: [-2.3833, 29.7167], Burera: [-1.47, 29.85],
  Burimbi: [-1.65, 30.2833], Buringa: [-1.85, 29.6333], Bushenge: [-2.5, 29.35],
  Busoro: [-2.5667, 29.7333], Butaro: [-1.4091, 29.8408], Bweyeye: [-2.8167, 29.1167],
  Byangabo: [-1.5614666, 29.5519921], Byimana: [-2.1833, 29.75], 'Congo Nile': [-2.0, 29.15],
  Cyabayaga: [-1.7, 30.2167], Cyahinda: [-2.7833, 29.5833], Cyanika: [-1.3442225, 29.7422547],
  Cyeza: [-2.0167, 29.6833], Cyili: [-2.0167, 30.5833], Cyuru: [-1.6, 30.1167],
  Gabiro: [-1.7667, 30.4333], Gahembe: [-2.1833, 30.2167], Gakenke: [-1.6468411, 29.7905962],
  Gakeri: [-1.7167, 29.3], Gakoma: [-2.45, 29.7667], Gasarenda: [-2.5, 29.5333],
  Gaseke: [-1.7664359, 30.12345], Gasetsa: [-2.2667, 30.75], Gashora: [-2.1833, 30.0833],
  Gatore: [-2.15, 30.7], Gatumba: [-1.9167, 29.2667], Gatuna: [-1.4259904, 30.0131516],
  Gicumbi: [-1.575028, 30.067889], Gikonko: [-2.5333, 29.8333], Gisagara: [-2.5833, 29.8333],
  Gishyita: [-2.0833, 29.2167], Gisiza: [-1.8167, 29.2667], Gisovu: [-2.1833, 29.2833],
  Hanika: [-2.3667, 29.2333], Huye: [-2.596, 29.7399], Janja: [-1.45, 29.4667],
  Kabali: [-1.7025694, 29.5557114], Kabarondo: [-2.0667, 30.5833], Kabarore: [-1.7, 30.5333],
  Kabaya: [-1.7455413, 29.5370299], Kabuga: [-1.9167, 30.1167], Kabuhanga: [-1.7, 29.1333],
  Kabukuba: [-2.1167, 30.0], Kaduha: [-2.55, 29.6667], Kagitumba: [-1.3667, 30.6167],
  Kamabuye: [-2.2, 30.2833], Kamembe: [-2.47, 28.91], Kamonyi: [-2.0, 29.75],
  Karama: [-1.7833, 30.3667], Karangazi: [-1.5167, 30.5833], Karenge: [-2.15, 30.6167],
  Karengera: [-2.3, 29.1167], Karongi: [-2.0833, 29.3667], Kayonza: [-1.9833, 30.6167],
  Kayove: [-1.65, 29.25], Kibangu: [-1.9833, 29.5167], Kibeho: [-2.6667, 29.5667],
  Kigeyo: [-1.8333, 29.2167], Kinazi: [-2.2833, 29.6167], Kinigi: [-1.4493044, 29.5878989],
  Kirambo: [-1.4951974, 29.834596], Kiramuruzi: [-1.85, 30.4667], Kitabi: [-2.5333, 29.4333],
  Kivumu: [-1.9667, 29.2333], Kivuye: [-1.5025583, 29.9353198], Kiziguro: [-1.7167, 30.4167],
  Mahama: [-2.1667, 30.9], Mahoko: [-1.6986903, 29.3425763], Manwari: [-2.3476491, 29.5831918],
  Matimba: [-1.5667, 30.5], Mimuri: [-1.6667, 30.3167], Miyove: [-1.611956, 29.976871],
  Mpanga: [-2.3333, 29.7167], Mubuga: [-2.25, 29.2], Mugina: [-2.05, 29.6],
  Mugombwa: [-2.45, 29.8667], Mugonero: [-2.1167, 29.2], Muhanga: [-2.0833, 29.75],
  Muhura: [-1.75, 30.3833], Mukamira: [-1.6138131, 29.5035382], Munini: [-2.7667, 29.6167],
  Musanze: [-1.5111627, 29.6418986], Mushubati: [-2.15, 29.2333], Mushubi: [-2.6833, 29.5],
  Muyumbu: [-1.9167, 30.2167], Nasho: [-2.1833, 30.8333], Ndago: [-2.5167, 29.7333],
  Nemba: [-2.15, 30.1667], Ngarama: [-1.6833, 30.4833], Ngoma: [-2.15, 30.6667],
  Ngororero: [-1.8534986, 29.6325626], Nkomero: [-1.8833, 29.2167], Nkora: [-1.7167, 29.1833],
  Nkumba: [-1.5167, 29.6167], Ntendezi: [-2.6667, 28.95], Ntunga: [-2.1, 30.5833],
  Nyabikenke: [-2.0333, 29.7], Nyabimata: [-2.7, 29.5333], Nyabugogo: [-1.9406284, 30.0445793],
  Nyagahanga: [-1.6333, 30.1833], Nyagasambu: [-2.0167, 30.8333], Nyagatare: [-1.2981, 30.3271],
  Nyakarambi: [-2.2167, 30.8333], Nyamagabe: [-2.45, 29.4833], Nyamasheke: [-2.35, 29.1667],
  Nyamata: [-2.15, 30.1167], Nyange: [-2.2333, 29.1667], Nyankora: [-2.1167, 30.5333],
  Nyanza: [-2.354, 29.738], Nyarusange: [-2.1167, 29.1833], Pfunda: [-1.7667, 29.2],
  Pindura: [-2.7667, 29.2167], Rambura: [-2.1333, 29.2833], Ramiro: [-2.2333, 30.1333],
  'Remera Rukoma': [-2.1667, 29.6167], Rilima: [-2.2, 30.1833], Rubavu: [-1.68, 29.2517],
  Rubengera: [-2.0167, 29.3833], Rufungo: [-2.1667, 29.3333], Rugarika: [-2.0333, 29.8333],
  Ruhango: [-2.2333, 29.7833], Ruheru: [-2.7333, 29.55], Ruhuha: [-2.1667, 30.25],
  Rukara: [-2.0333, 30.6167], Rukomo: [-1.6292223, 30.1038379], Ruli: [-1.7833, 29.9667],
  Rushaki: [-1.6667, 30.1833], Rushashi: [-1.7833, 29.9167], Rusumo: [-2.3833, 30.7833],
  Rutare: [-1.7310335, 30.1771689], Rwagitima: [-1.6833, 30.45], Rwamagana: [-1.9483, 30.4348],
  Rwimiyaga: [-1.5667, 30.6333], Rwinkwavu: [-2.1167, 30.7167], Ryabega: [-1.5833, 30.5667],
  Sake: [-2.0667, 30.0833], Shyorongi: [-1.8167, 29.9833], Tabagwe: [-1.4833, 30.4667],
  Tetero: [-1.6103927, 29.9743236], Tyazo: [-2.3333, 29.2833], Vunga: [-1.6935782, 29.6328019],
  Zaza: [-2.2667, 30.3333],
};

// Flagship routes — origin = first stop, destination = last. Intermediate stops
// ordered along the corridor (Rwanda geography + RURA "via" hints).
export const ROUTES: { name: string; stops: string[] }[] = [
  { name: 'Nyabugogo – Huye',    stops: ['Nyabugogo', 'Muhanga', 'Ruhango', 'Nyanza', 'Huye'] },
  { name: 'Nyabugogo – Rubavu',  stops: ['Nyabugogo', 'Base', 'Gakenke', 'Musanze', 'Mukamira', 'Rubavu'] },
  { name: 'Nyabugogo – Nyagatare', stops: ['Nyabugogo', 'Kayonza', 'Gabiro', 'Nyagatare'] },
  { name: 'Nyabugogo – Rusumo',  stops: ['Nyabugogo', 'Rwamagana', 'Kayonza', 'Kabarondo', 'Ngoma', 'Rusumo'] },
  { name: 'Nyabugogo – Kamembe', stops: ['Nyabugogo', 'Muhanga', 'Karongi', 'Rubengera', 'Kamembe'] },
  { name: 'Nyabugogo – Gatuna',  stops: ['Nyabugogo', 'Gaseke', 'Rukomo', 'Gicumbi', 'Gatuna'] },
];

// Fares from the RURA INTERCITY 2026 tariff (RWF). Stored both directions.
export const PRICES: [string, string, number][] = [
  // South
  ['Nyabugogo', 'Muhanga', 2040], ['Muhanga', 'Ruhango', 1089], ['Ruhango', 'Nyanza', 753],
  ['Nyanza', 'Huye', 1465], ['Muhanga', 'Nyanza', 1624], ['Muhanga', 'Huye', 3089],
  ['Ruhango', 'Huye', 2118], ['Nyabugogo', 'Ruhango', 2950], ['Nyabugogo', 'Nyanza', 3664],
  ['Nyabugogo', 'Huye', 5068],
  // Northwest
  ['Nyabugogo', 'Base', 2158], ['Base', 'Gakenke', 515], ['Gakenke', 'Musanze', 1307],
  ['Base', 'Musanze', 1801], ['Musanze', 'Mukamira', 1050], ['Musanze', 'Rubavu', 2573],
  ['Nyabugogo', 'Gakenke', 2416], ['Nyabugogo', 'Musanze', 3821],
  // Northeast (Kayonza – Nyagatare)
  ['Nyabugogo', 'Kayonza', 3129], ['Kayonza', 'Gabiro', 2217], ['Gabiro', 'Nyagatare', 1465],
  ['Kayonza', 'Nyagatare', 3584], ['Nyabugogo', 'Nyagatare', 6712],
  // East (Rusumo)
  ['Nyabugogo', 'Rwamagana', 2495], ['Rwamagana', 'Kayonza', 1544], ['Kayonza', 'Kabarondo', 653],
  ['Kabarondo', 'Ngoma', 653], ['Ngoma', 'Rusumo', 2316], ['Rwamagana', 'Ngoma', 2040],
  ['Rwamagana', 'Rusumo', 4237], ['Kabarondo', 'Rusumo', 2950], ['Kayonza', 'Rusumo', 3821],
  // West (Kamembe via Karongi)
  ['Muhanga', 'Karongi', 3742], ['Karongi', 'Rubengera', 673], ['Rubengera', 'Kamembe', 1465],
  ['Karongi', 'Kamembe', 4792], ['Muhanga', 'Kamembe', 8534], ['Nyabugogo', 'Kamembe', 10296],
  ['Nyabugogo', 'Karongi', 3742 + 2040],
  // North (Gatuna via Gicumbi)
  ['Nyabugogo', 'Gaseke', 1169], ['Gaseke', 'Rukomo', 910], ['Rukomo', 'Gicumbi', 416],
  ['Gicumbi', 'Gatuna', 1465], ['Nyabugogo', 'Gicumbi', 2297], ['Nyabugogo', 'Gatuna', 3248],
  ['Gaseke', 'Gicumbi', 1247], ['Gaseke', 'Gatuna', 2079], ['Rukomo', 'Gatuna', 1406],
];

export const BUSES = [
  { plate: 'RAD 100 A', type: 'Coaster', total_seats: 30 },
  { plate: 'RAD 200 B', type: 'Coaster', total_seats: 30 },
  { plate: 'RAD 300 C', type: 'Minibus', total_seats: 18 },
  { plate: 'RAD 400 D', type: 'Coaster', total_seats: 30 },
  { plate: 'RAC 500 E', type: 'Large Bus', total_seats: 60 },
  { plate: 'RAC 600 F', type: 'Large Bus', total_seats: 60 },
  { plate: 'RAD 700 G', type: 'Minibus', total_seats: 18 },
  { plate: 'RAD 800 H', type: 'Coaster', total_seats: 30 },
];

// ── Geometry / naming helpers shared by bootstrap + seed script ──────────────
const toRad = (d: number): number => (d * Math.PI) / 180;

export const haversineKm = (a: [number, number], b: [number, number]): number => {
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Estimated route duration (minutes): ~45 km/h along the corridor + dwell. */
export const routeDurationMin = (stops: string[]): number => {
  let km = 0;
  for (let i = 1; i < stops.length; i++) km += haversineKm(STOPS[stops[i - 1]], STOPS[stops[i]]);
  return Math.round((km / 45) * 60) + 15;
};
