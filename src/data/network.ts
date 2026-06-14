/**
 * Canonical reference network for trip-service — the single source of truth for
 * the operator, stops, buses, routes and fares the service needs to function.
 *
 * Everything that seeds these tables derives from this file:
 *   - loaders/bootstrap.ts   idempotently upserts it on every startup
 *   - scripts/seed-network.ts (dev only) wipes the DB, calls bootstrap, then
 *                             generates random future trips on top
 *
 * Stops are reference geography (real Rwanda locations with their coordinates).
 * Fares are the RURA INTERCITY 2026 tariff (RWF, integer) — see
 * docs / "INTERCITY PUBLIC TRANSPORT TARIFF 2026". The routes/fares/buses belong
 * to the flagship demo operator (Volcano Express, same id as its user-service org
 * so tickets and wallet line up).
 */

// Volcano Express — same id as the user-service org.
export const ORG = {
  id: 'c7851517-492f-4dfc-bf63-41263bcc7c8a',
  name: 'Volcano Express',
  slug: 'volcano-express',
  tin: '102000300',
};

// name -> [lat, lng]. Real coordinates.
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
  Hanika: [-2.3667, 29.2333], Huye: [-2.590562, 29.743306], Janja: [-1.45, 29.4667],
  Kabali: [-1.7025694, 29.5557114], Kabarondo: [-2.01256, 30.558355], Kabarore: [-1.7, 30.5333],
  Kabaya: [-1.7455413, 29.5370299], Kabuhanga: [-1.7, 29.1333], Kabukuba: [-2.1167, 30.0],
  Kaduha: [-2.55, 29.6667], Kagitumba: [-1.3667, 30.6167], Kamabuye: [-2.2, 30.2833],
  Kamembe: [-2.47, 28.91], Kamonyi: [-2.0, 29.75], Karama: [-1.7833, 30.3667],
  Karangazi: [-1.5167, 30.5833], Karenge: [-2.15, 30.6167], Karengera: [-2.3, 29.1167],
  Karongi: [-2.068892, 29.350898], Kayonza: [-1.9833, 30.6167], Kayove: [-1.65, 29.25],
  Kibangu: [-1.9833, 29.5167], Kibeho: [-2.6667, 29.5667], Kigeyo: [-1.8333, 29.2167],
  Kinazi: [-2.2833, 29.6167], Kinigi: [-1.448686, 29.588478], Kirambo: [-1.4951974, 29.834596],
  Kiramuruzi: [-1.85, 30.4667], Kitabi: [-2.5333, 29.4333], Kivumu: [-1.9667, 29.2333],
  Kivuye: [-1.5025583, 29.9353198], Kiziguro: [-1.7167, 30.4167], Mahama: [-2.1667, 30.9],
  Mahoko: [-1.698611, 29.342356], Manwari: [-2.3476491, 29.5831918], Matimba: [-1.5667, 30.5],
  Mimuri: [-1.6667, 30.3167], Miyove: [-1.611956, 29.976871], Mpanga: [-2.3333, 29.7167],
  Mubuga: [-2.25, 29.2], Mugina: [-2.05, 29.6], Mugombwa: [-2.45, 29.8667],
  Mugonero: [-2.1167, 29.2], Muhanga: [-2.08314, 29.751634], Muhura: [-1.75, 30.3833],
  Mukamira: [-1.614049, 29.503602], Munini: [-2.7667, 29.6167], Musanze: [-1.511611, 29.641611],
  Mushubati: [-2.15, 29.2333], Mushubi: [-2.6833, 29.5], Muyumbu: [-1.9167, 30.2167],
  Nasho: [-2.1833, 30.8333], Ndago: [-2.5167, 29.7333], Nemba: [-2.15, 30.1667], Ngarama: [-1.6833, 30.4833],
  Ngoma: [-2.137359, 30.558211], Ngororero: [-1.853499, 29.632563], Nkomero: [-1.8833, 29.2167],
  Nkora: [-1.7167, 29.1833], Nkumba: [-1.5167, 29.6167], Ntendezi: [-2.6667, 28.95],
  Ntunga: [-1.961372, 30.351528], Nyabikenke: [-2.0333, 29.7], Nyabimata: [-2.7, 29.5333],
  Nyabugogo: [-1.9406284, 30.0445793], Nyagahanga: [-1.6333, 30.1833], Nyagasambu: [-2.0167, 30.8333],
  Nyagatare: [-1.2981, 30.3271], Nyakarambi: [-2.275856, 30.674503], Nyamagabe: [-2.473075, 29.581348],
  Nyamasheke: [-2.35, 29.1667], Nyamata: [-2.141938, 30.086348], Nyange: [-2.2333, 29.1667],
  Nyankora: [-2.1167, 30.5333], Nyanza: [-2.352773, 29.751513], Nyarusange: [-2.1167, 29.1833],
  Pfunda: [-1.7667, 29.2], Pindura: [-2.7667, 29.2167], Rambura: [-2.1333, 29.2833],
  Ramiro: [-2.2333, 30.1333], 'Remera Rukoma': [-2.1667, 29.6167], Rilima: [-2.2, 30.1833],
  Rubavu: [-1.682227, 29.250411], Rubengera: [-2.051444, 29.4135], Rufungo: [-2.1667, 29.3333],
  Rugarika: [-2.0333, 29.8333], Ruhango: [-2.232081, 29.78677], Ruheru: [-2.7333, 29.55],
  Ruhuha: [-2.1667, 30.25], Rukara: [-2.0333, 30.6167], Rukomo: [-1.6292223, 30.1038379],
  Ruli: [-1.7833, 29.9667], Rushaki: [-1.6667, 30.1833], Rushashi: [-1.7833, 29.9167], Rusumo: [-2.3833, 30.7833],
  Rutare: [-1.7310335, 30.1771689], Rwagitima: [-1.6833, 30.45], Rwamagana: [-1.948911, 30.42218],
  Rwimiyaga: [-1.5667, 30.6333], Rwinkwavu: [-2.1167, 30.7167], Ryabega: [-1.5833, 30.5667],
  Sake: [-2.0667, 30.0833], Shyorongi: [-1.8167, 29.9833], Tabagwe: [-1.4833, 30.4667],
  Tetero: [-1.6103927, 29.9743236], Tyazo: [-2.3333, 29.2833], Vunga: [-1.6935782, 29.6328019],
  Zaza: [-2.2667, 30.3333], Kacyiru: [-1.936628, 30.081224], 'Kicukiro (Nyanza)': [-2.001014, 30.091257],
  Zindiro: [-1.9286, 30.137702], Kabuga: [-1.979123, 30.223227], Kinyinya: [-1.913429, 30.109421],
  Nyirangarama: [-1.663234, 29.887267], Rusizi: [-2.487977, 28.918006], Downtown: [-1.943461, 30.057289],
  Kimironko: [-1.949593, 30.125549], Remera: [-1.958684, 30.118964],
};

/**
 * Approximate province for a coordinate — Rwanda's 5 provinces by rough lat/lng
 * bounds. Good enough to populate the `province` field on seeded stops; border
 * towns may be slightly off and can be corrected via the API.
 */
export const provinceFor = ([lat, lng]: [number, number]): string => {
  if (lat <= -1.86 && lat >= -2.05 && lng >= 29.99 && lng <= 30.17) return 'Kigali City';
  if (lng < 29.6) return 'Western Province';
  if (lng > 30.2) return 'Eastern Province';
  if (lat > -1.85) return 'Northern Province';
  if (lat < -2.1) return 'Southern Province';
  return lng > 30.05 ? 'Eastern Province' : 'Southern Province';
};

// Corridor routes (platform defaults) with ordered intermediate stops — the real
// RURA corridors, with main towns sequenced by geography.
export const ROUTES: { name: string; stops: string[] }[] = [
  { name: 'Nyabugogo — Gicumbi — Gatuna', stops: ['Nyabugogo', 'Gaseke', 'Rukomo', 'Gicumbi', 'Gatuna'] },
  { name: 'Nyabugogo — Musanze — Rubavu', stops: ['Nyabugogo', 'Base', 'Gakenke', 'Musanze', 'Mukamira', 'Rubavu'] },
  { name: 'Gicumbi — Nyagatare', stops: ['Gicumbi', 'Ngarama', 'Nyagatare'] },
  { name: 'Nyabugogo — Kayonza — Nyagatare', stops: ['Nyabugogo', 'Rwamagana', 'Kayonza', 'Gabiro', 'Nyagatare'] },
  { name: 'Nyabugogo — Rwamagana — Rusumo', stops: ['Nyabugogo', 'Rwamagana', 'Kayonza', 'Kabarondo', 'Ngoma', 'Rusumo'] },
  { name: 'Nyabugogo — Bugesera — Zaza', stops: ['Kicukiro (Nyanza)', 'Nyamata', 'Ramiro', 'Zaza'] },
  { name: 'Nyabugogo — Muhanga — Huye — Nyamagabe', stops: ['Nyabugogo', 'Muhanga', 'Ruhango', 'Nyanza', 'Huye', 'Nyamagabe'] },
  { name: 'Nyabugogo — Muhanga — Karongi — Kamembe', stops: ['Nyabugogo', 'Muhanga', 'Karongi', 'Rubengera', 'Nyamasheke', 'Kamembe'] },
  { name: 'Nyabugogo — Muhanga — Ngororero — Rubavu', stops: ['Nyabugogo', 'Muhanga', 'Buringa', 'Gatumba', 'Ngororero', 'Mukamira', 'Rubavu'] },
  { name: 'Nyabugogo — Nyabihu — Rubavu', stops: ['Nyabugogo', 'Musanze', 'Mukamira', 'Kabali', 'Rubavu'] },
  { name: 'Rubavu — Karongi — Kamembe', stops: ['Rubavu', 'Gisiza', 'Congo Nile', 'Karongi', 'Rubengera', 'Kamembe'] },
];

/**
 * The real RURA INTERCITY 2026 tariff (RWF), one directional entry per tariff
 * row. **Currently not exported as the live fares** — see PRICES below. Kept so
 * the real tariff can be restored (export it as PRICES instead of buildFlatPrices).
 */
const TARIFF_2026: [string, string, number][] = [
  // ── Northern: Nyabugogo — Gicumbi — Gatuna ────────────────────────────────
  ['Rukomo', 'Gicumbi', 416], ['Gaseke', 'Rukomo', 910], ['Miyove', 'Base', 951],
  ['Nyabugogo', 'Gaseke', 1169], ['Gicumbi', 'Tetero', 1188], ['Gaseke', 'Gicumbi', 1247],
  ['Rukomo', 'Gatuna', 1406], ['Gicumbi', 'Gatuna', 1465], ['Miyove', 'Gakenke', 1505],
  ['Kivuye', 'Butaro', 1625], ['Gicumbi', 'Base', 1980], ['Gicumbi', 'Rutare', 1980],
  ['Nyabugogo', 'Rukomo', 2040], ['Gaseke', 'Gatuna', 2079], ['Nyabugogo', 'Gicumbi', 2297],
  ['Gicumbi', 'Gakenke', 2713], ['Gicumbi', 'Kivuye', 2730], ['Miyove', 'Musanze', 2772],
  ['Nyabugogo', 'Gatuna', 3248], ['Gicumbi', 'Musanze', 4356], ['Gicumbi', 'Butaro', 4356],
  ['Musanze', 'Burera', 6336],
  // ── Northern: Nyabugogo — Musanze — Rubavu ────────────────────────────────
  ['Musanze', 'Kinigi', 436], ['Base', 'Gakenke', 515], ['Musanze', 'Byangabo', 693],
  ['Musanze', 'Mukamira', 1050], ['Musanze', 'Cyanika', 1050], ['Musanze', 'Vunga', 1287],
  ['Gakenke', 'Musanze', 1307], ['Musanze', 'Kabali', 1782], ['Base', 'Musanze', 1801],
  ['Musanze', 'Mahoko', 2099], ['Nyabugogo', 'Base', 2158], ['Base', 'Kirambo', 2198],
  ['Musanze', 'Kabaya', 2258], ['Gakenke', 'Mukamira', 2357], ['Nyabugogo', 'Gakenke', 2416],
  ['Musanze', 'Janja', 2534], ['Musanze', 'Butaro', 2573], ['Musanze', 'Rubavu', 2573],
  ['Nyabugogo', 'Rushashi', 2693], ['Musanze', 'Kirambo', 2970], ['Musanze', 'Ngororero', 3485],
  ['Base', 'Butaro', 3783], ['Nyabugogo', 'Musanze', 3821], ['Nyabugogo', 'Butaro', 5940],
  // ── Northern: Gicumbi — Nyagatare ─────────────────────────────────────────
  ['Rushaki', 'Karama', 990], ['Karama', 'Rukomo', 634], ['Karama', 'Nyagatare', 1505],
  ['Ngarama', 'Nyagatare', 1525], ['Gicumbi', 'Rushaki', 2198], ['Rushaki', 'Nyagatare', 2297],
  ['Nyabugogo', 'Cyuru', 2376], ['Gicumbi', 'Karama', 2732], ['Nyabugogo', 'Burimbi', 2772],
  ['Nyabugogo', 'Ruli', 2950], ['Gicumbi', 'Ngarama', 2970], ['Nyabugogo', 'Nyagahanga', 3366],
  ['Gicumbi', 'Nyagatare', 3683], ['Nyabugogo', 'Ngarama', 3960], ['Gicumbi', 'Rukomo', 4138],
  ['Nyabugogo', 'Mimuri', 4356], ['Nyabugogo', 'Kirambo', 4356], ['Nyabugogo', 'Nyagatare', 5346],
  ['Gicumbi', 'Buguma', 5940],
  // ── Eastern: Nyabugogo — Kayonza — Nyagatare ──────────────────────────────
  ['Karangazi', 'Ryabega', 198], ['Kiramuruzi', 'Kiziguro', 297], ['Kiziguro', 'Rwagitima', 337],
  ['Rwagitima', 'Kabarore', 337], ['Bugaragara', 'Rwimiyaga', 337], ['Kabarore', 'Gabiro', 356],
  ['Matimba', 'Kagitumba', 377], ['Ryabega', 'Bugaragara', 416], ['Rwimiyaga', 'Matimba', 494],
  ['Kayonza', 'Kiramuruzi', 634], ['Kiramuruzi', 'Rwagitima', 634], ['Kiziguro', 'Kabarore', 673],
  ['Rwagitima', 'Gabiro', 673], ['Gabiro', 'Karangazi', 753], ['Ryabega', 'Rwimiyaga', 753],
  ['Ryabega', 'Nyagatare', 832], ['Bugaragara', 'Matimba', 832], ['Rwimiyaga', 'Kagitumba', 871],
  ['Gabiro', 'Ryabega', 951], ['Nyagatare', 'Mimuri', 951], ['Nyagatare', 'Bugaragara', 951],
  ['Kiziguro', 'Gabiro', 990], ['Kiramuruzi', 'Kabarore', 1050], ['Kabarore', 'Karangazi', 1050],
  ['Karangazi', 'Nyagatare', 1050], ['Nyagatare', 'Rukomo', 1050], ['Kayonza', 'Kiziguro', 1208],
  ['Bugaragara', 'Kagitumba', 1208], ['Kabarore', 'Ryabega', 1247], ['Ryabega', 'Matimba', 1247],
  ['Kiramuruzi', 'Gabiro', 1287], ['Nyagatare', 'Rwimiyaga', 1287], ['Rwagitima', 'Karangazi', 1406],
  ['Gabiro', 'Nyagatare', 1465], ['Kayonza', 'Rwagitima', 1544], ['Rwamagana', 'Kiramuruzi', 1544],
  ['Rwagitima', 'Ryabega', 1624], ['Kabarore', 'Nyagatare', 1663], ['Karama', 'Nyagatare', 1702],
  ['Kiziguro', 'Karangazi', 1742], ['Rwamagana', 'Kiziguro', 1742], ['Nyagatare', 'Matimba', 1742],
  ['Kayonza', 'Kabarore', 1881], ['Kiziguro', 'Ryabega', 1960], ['Ryabega', 'Kagitumba', 1960],
  ['Kiramuruzi', 'Karangazi', 2040], ['Rwagitima', 'Nyagatare', 2139], ['Nyagatare', 'Kagitumba', 2158],
  ['Kayonza', 'Gabiro', 2217], ['Kiramuruzi', 'Ryabega', 2237], ['Rwamagana', 'Rwagitima', 2416],
  ['Kiziguro', 'Nyagatare', 2435], ['Rwamagana', 'Kabarore', 2594], ['Kiramuruzi', 'Nyagatare', 2752],
  ['Kabarore', 'Kagitumba', 2911], ['Kayonza', 'Karangazi', 2950], ['Rwamagana', 'Gabiro', 2950],
  ['Kabuga', 'Kiramuruzi', 3009], ['Nyabugogo', 'Kayonza', 3129], ['Kayonza', 'Ryabega', 3168],
  ['Kayonza', 'Nyagatare', 3584], ['Rwamagana', 'Karangazi', 3664], ['Rwamagana', 'Ryabega', 3880],
  ['Kabuga', 'Kabarore', 4079], ['Nyabugogo', 'Kiramuruzi', 4158], ['Rwamagana', 'Nyagatare', 4257],
  ['Rwamagana', 'Bugaragara', 4316], ['Nyabugogo', 'Kiziguro', 4356], ['Rwamagana', 'Rwimiyaga', 4613],
  ['Nyabugogo', 'Rwagitima', 4792], ['Nyabugogo', 'Kabarore', 5010], ['Nyabugogo', 'Muhura', 5068],
  ['Rwamagana', 'Matimba', 5148], ['Kabuga', 'Karangazi', 5148], ['Kabuga', 'Ryabega', 5366],
  ['Rwamagana', 'Kagitumba', 5525], ['Nyabugogo', 'Gabiro', 5584], ['Kabuga', 'Nyagatare', 5900],
  ['Nyabugogo', 'Karangazi', 6058], ['Kabuga', 'Rwimiyaga', 6118], ['Nyabugogo', 'Ryabega', 6276],
  ['Nyabugogo', 'Ngarama', 6316], ['Kabuga', 'Matimba', 6653], ['Nyabugogo', 'Nyagatare', 6712],
  ['Nyabugogo', 'Bugaragara', 6811], ['Kabuga', 'Kagitumba', 7029], ['Nyabugogo', 'Rwimiyaga', 7147],
  ['Nyabugogo', 'Matimba', 7643], ['Nyabugogo', 'Kagitumba', 7900],
  // ── Eastern: Nyabugogo — Rwamagana — Rusumo ───────────────────────────────
  ['Kabuga', 'Muyumbu', 356], ['Gatore', 'Nyakarambi', 455], ['Kabarondo', 'Rwinkwavu', 515],
  ['Kabuga', 'Nyagasambu', 595], ['Rwamagana', 'Kayonza', 634], ['Kayonza', 'Kabarondo', 653],
  ['Kabarondo', 'Ngoma', 653], ['Kabarondo', 'Nyankora', 792], ['Nyagasambu', 'Rwamagana', 910],
  ['Nyakarambi', 'Rusumo', 910], ['Kabuga', 'Ntunga', 930], ['Ngoma', 'Gatore', 1050],
  ['Ngoma', 'Rwinkwavu', 1149], ['Kayonza', 'Rwinkwavu', 1188], ['Rwamagana', 'Kabarondo', 1287],
  ['Gatore', 'Rusumo', 1326], ['Kabuga', 'Cyili', 1326], ['Kabuga', 'Karenge', 1386],
  ['Ngoma', 'Nyankora', 1426], ['Kayonza', 'Ngoma', 1465], ['Kayonza', 'Nyankora', 1484],
  ['Kabuga', 'Rwamagana', 1484], ['Ngoma', 'Nyakarambi', 1525], ['Nyabugogo', 'Nyagasambu', 1604],
  ['Nyagasambu', 'Kayonza', 1624], ['Kabarondo', 'Gatore', 1684], ['Rwamagana', 'Rwinkwavu', 1900],
  ['Rwamagana', 'Ngoma', 2040], ['Kabarondo', 'Nyakarambi', 2139], ['Rwamagana', 'Nyankora', 2217],
  ['Kabuga', 'Kayonza', 2217], ['Ngoma', 'Rusumo', 2316], ['Kayonza', 'Gatore', 2376],
  ['Nyabugogo', 'Rwamagana', 2495], ['Gasetsa', 'Rusumo', 2633], ['Kayonza', 'Nyakarambi', 2832],
  ['Kabuga', 'Kabarondo', 2890], ['Kabarondo', 'Rusumo', 2950], ['Rwamagana', 'Gatore', 3089],
  ['Kabarondo', 'Nasho', 3267], ['Kabuga', 'Ngoma', 3544], ['Rwamagana', 'Nyakarambi', 3563],
  ['Kayonza', 'Rusumo', 3821], ['Ngoma', 'Nasho', 3921], ['Nyabugogo', 'Kabarondo', 3940],
  ['Kayonza', 'Nasho', 3979], ['Rwamagana', 'Rusumo', 4237], ['Nyabugogo', 'Ngoma', 4574],
  ['Rwamagana', 'Nasho', 4693], ['Kabuga', 'Nyakarambi', 5029], ['Nyabugogo', 'Buhabwa', 5484],
  ['Nyabugogo', 'Gatore', 5623], ['Kabuga', 'Rusumo', 5980], ['Nyabugogo', 'Nyakarambi', 6079],
  ['Nyabugogo', 'Rusumo', 7029], ['Nyabugogo', 'Mahama', 7921],
  // ── Eastern: Nyabugogo — Bugesera — Zaza ──────────────────────────────────
  ['Ramiro', 'Batima', 792], ['Sake', 'Gashora', 871], ['Nyamata', 'Ramiro', 990],
  ['Kicukiro (Nyanza)', 'Nyamata', 1029], ['Sake', 'Ramiro', 1109], ['Zaza', 'Gashora', 1346],
  ['Nyamata', 'Kabukuba', 1445], ['Nyamata', 'Rilima', 1465], ['Zaza', 'Ramiro', 1585],
  ['Nyamata', 'Batima', 1702], ['Nyamata', 'Ruhuha', 1822], ['Sake', 'Nyamata', 2000],
  ['Busoro', 'Nyanza', 2019], ['Nyamata', 'Nemba', 2118], ['Ngoma', 'Gashora', 2139],
  ['Kicukiro (Nyanza)', 'Ramiro', 2198], ['Kicukiro (Nyanza)', 'Gashora', 2297], ['Kicukiro (Nyanza)', 'Rilima', 2297],
  ['Ngoma', 'Ramiro', 2357], ['Kicukiro (Nyanza)', 'Batima', 2456], ['Nyamata', 'Kamabuye', 2456],
  ['Zaza', 'Nyamata', 2474], ['Kicukiro (Nyanza)', 'Ruhuha', 2515], ['Kicukiro (Nyanza)', 'Kabukuba', 2752],
  ['Nyamata', 'Nyanza', 2871], ['Kicukiro (Nyanza)', 'Nemba', 3168], ['Busoro', 'Huye', 3207],
  ['Ngoma', 'Nyamata', 3267], ['Kicukiro (Nyanza)', 'Kamabuye', 3901], ['Nyamata', 'Huye', 3921],
  ['Kicukiro (Nyanza)', 'Sake', 4138], ['Kicukiro (Nyanza)', 'Zaza', 5049],
  // ── Southern: Nyabugogo — Muhanga — Huye — Nyamagabe ──────────────────────
  ['Huye', 'Gisagara', 653], ['Gasarenda', 'Kitabi', 712], ['Ruhango', 'Nyanza', 753],
  ['Nyamagabe', 'Gasarenda', 852], ['Nyabugogo', 'Kamonyi', 914], ['Nyamagabe', 'Kaduha', 930],
  ['Ruhango', 'Buhanda', 1069], ['Buhanda', 'Nyanza', 1069], ['Muhanga', 'Ruhango', 1089],
  ['Huye', 'Nyamagabe', 1109], ['Huye', 'Kibeho', 1247], ['Nyabugogo', 'Rugarika', 1287],
  ['Pindura', 'Bweyeye', 1287], ['Nyamagabe', 'Kitabi', 1367], ['Huye', 'Akanyaru', 1406],
  ['Muhanga', 'Remera Rukoma', 1406], ['Nyanza', 'Huye', 1465], ['Huye', 'Ndago', 1544],
  ['Muhanga', 'Mugina', 1544], ['Muhanga', 'Nyanza', 1624], ['Nyamagabe', 'Mushubi', 1663],
  ['Huye', 'Gakoma', 1723], ['Muhanga', 'Buhanda', 1822], ['Muhanga', 'Kinazi', 1842],
  ['Huye', 'Gasarenda', 1921], ['Ruhango', 'Birambo', 1980], ['Huye', 'Gakoma', 1980],
  ['Huye', 'Gikonko', 1980], ['Huye', 'Munini', 2000], ['Kamembe', 'Pindura', 2019],
  ['Nyabugogo', 'Muhanga', 2040], ['Nyabugogo', 'Remera Rukoma', 2099], ['Ruhango', 'Huye', 2118],
  ['Huye', 'Mugombwa', 2118], ['Nyabugogo', 'Kamonyi', 2139], ['Nyabugogo', 'Kinazi', 2178],
  ['Muhanga', 'Nyabikenke', 2237], ['Nyanza', 'Nyamagabe', 2474], ['Huye', 'Kitabi', 2495],
  ['Huye', 'Akanyaru', 2515], ['Huye', 'Munini', 2653], ['Nyamagabe', 'Pindura', 2772],
  ['Huye', 'Mushubi', 2791], ['Huye', 'Agatunda', 2970], ['Nyabugogo', 'Ruhango', 2950],
  ['Muhanga', 'Huye', 3089], ['Ruhango', 'Kaduha', 3089], ['Nyanza', 'Gasarenda', 3148],
  ['Ruhango', 'Nyamagabe', 3228], ['Kamembe', 'Bweyeye', 3326], ['Nyabugogo', 'Buhanda', 3347],
  ['Kitabi', 'Kamembe', 3446], ['Nyabugogo', 'Nyanza', 3664], ['Nyanza', 'Kitabi', 3861],
  ['Huye', 'Pindura', 3901], ['Ruhango', 'Gasarenda', 3960], ['Huye', 'Nyabimata', 3960],
  ['Huye', 'Ruheru', 3960], ['Nyamagabe', 'Bweyeye', 4079], ['Muhanga', 'Nyamagabe', 4158],
  ['Gasarenda', 'Kamembe', 4158], ['Nyabugogo', 'Buhanda', 4316], ['Nyabugogo', 'Birambo', 4415],
  ['Muhanga', 'Gasarenda', 4911], ['Nyabugogo', 'Birambo', 4950], ['Nyamagabe', 'Kamembe', 4990],
  ['Nyabugogo', 'Huye', 5068], ['Huye', 'Bweyeye', 5187], ['Muhanga', 'Kitabi', 5623],
  ['Nyabugogo', 'Kaduha', 5940], ['Nyabugogo', 'Kaduha', 6019], ['Huye', 'Kamembe', 6198],
  ['Nyabugogo', 'Nyamagabe', 6653], ['Nyabugogo', 'Gasarenda', 6871], ['Nyanza', 'Kamembe', 7306],
  ['Nyabugogo', 'Kitabi', 7563], ['Ruhango', 'Kamembe', 8514], ['Nyabugogo', 'Mushubi', 9524],
  ['Muhanga', 'Kamembe', 9603], ['Nyabugogo', 'Pindura', 10930], ['Nyabugogo', 'Kamembe', 11445],
  // ── Western: Nyabugogo — Muhanga — Karongi — Kamembe ──────────────────────
  ['Rufungo', 'Rambura', 218], ['Mubuga', 'Gishyita', 257], ['Hanika', 'Kirambo', 297],
  ['Tyazo', 'Nyamasheke', 337], ['Karengera', 'Hanika', 377], ['Nyange', 'Rufungo', 416],
  ['Gishyita', 'Mugonero', 416], ['Hanika', 'Tyazo', 416], ['Kirambo', 'Nyamasheke', 455],
  ['Muhanga', 'Nyarusange', 614], ['Nyange', 'Rambura', 634], ['Nyarusange', 'Nyange', 673],
  ['Rambura', 'Rubengera', 673], ['Rubengera', 'Karongi', 673], ['Mubuga', 'Mugonero', 673],
  ['Karengera', 'Kirambo', 673], ['Mugonero', 'Karengera', 712], ['Karongi', 'Mubuga', 753],
  ['Hanika', 'Nyamasheke', 753], ['Karengera', 'Tyazo', 792], ['Kamembe', 'Bushenge', 852],
  ['Rufungo', 'Rubengera', 891], ['Karongi', 'Gishyita', 1069], ['Nyarusange', 'Rufungo', 1089],
  ['Mugonero', 'Hanika', 1089], ['Gishyita', 'Karengera', 1128], ['Karengera', 'Nyamasheke', 1128],
  ['Muhanga', 'Nyange', 1188], ['Nyarusange', 'Rambura', 1307], ['Nyange', 'Rubengera', 1307],
  ['Rambura', 'Congo Nile', 1326], ['Mubuga', 'Karengera', 1367], ['Mugonero', 'Kirambo', 1367],
  ['Karongi', 'Mugonero', 1406], ['Rambura', 'Karongi', 1426], ['Nyamasheke', 'Kamembe', 1445],
  ['Rubengera', 'Mubuga', 1465], ['Gishyita', 'Hanika', 1505], ['Mugonero', 'Tyazo', 1505],
  ['Mushubati', 'Nyange', 1624], ['Rufungo', 'Karongi', 1643], ['Muhanga', 'Rufungo', 1702],
  ['Rubengera', 'Gishyita', 1702], ['Mubuga', 'Hanika', 1742], ['Gishyita', 'Kirambo', 1782],
  ['Mugonero', 'Nyamasheke', 1822], ['Tyazo', 'Kamembe', 1822], ['Karongi', 'Karengera', 1900],
  ['Gishyita', 'Tyazo', 1921], ['Kirambo', 'Kamembe', 1921], ['Nyarusange', 'Rubengera', 1960],
  ['Nyange', 'Congo Nile', 1960], ['Nyange', 'Karongi', 2040], ['Mubuga', 'Kirambo', 2040],
  ['Muhanga', 'Rambura', 2059], ['Rambura', 'Mubuga', 2118], ['Rubengera', 'Mugonero', 2118],
  ['Mubuga', 'Tyazo', 2158], ['Gishyita', 'Nyamasheke', 2237], ['Hanika', 'Kamembe', 2258],
  ['Rufungo', 'Mubuga', 2336], ['Rambura', 'Gishyita', 2376], ['Mubuga', 'Nyamasheke', 2495],
  ['Nyabugogo', 'Nyarusange', 2573], ['Rufungo', 'Gishyita', 2594], ['Karongi', 'Hanika', 2594],
  ['Karengera', 'Kamembe', 2614], ['Nyarusange', 'Congo Nile', 2633], ['Muhanga', 'Rubengera', 2674],
  ['Nyarusange', 'Karongi', 2713], ['Nyange', 'Mubuga', 2752], ['Karongi', 'Kirambo', 2752],
  ['Rambura', 'Mugonero', 2791], ['Rubengera', 'Karengera', 2832], ['Karongi', 'Tyazo', 2832],
  ['Muhanga', 'Mushubati', 2911], ['Karongi', 'Nyamasheke', 2989], ['Nyange', 'Gishyita', 3009],
  ['Rufungo', 'Mugonero', 3009], ['Rubengera', 'Hanika', 3207], ['Muhanga', 'Congo Nile', 3267],
  ['Nyabugogo', 'Nyange', 3366], ['Mugonero', 'Kamembe', 3405], ['Nyarusange', 'Mubuga', 3425],
  ['Nyange', 'Mugonero', 3425], ['Rubengera', 'Kirambo', 3485], ['Rambura', 'Karengera', 3505],
  ['Karongi', 'Ntendezi', 3604], ['Rubengera', 'Tyazo', 3623], ['Nyabugogo', 'Rufungo', 3643],
  ['Nyarusange', 'Gishyita', 3664], ['Rufungo', 'Karengera', 3722], ['Muhanga', 'Karongi', 3742],
  ['Gishyita', 'Kamembe', 3781], ['Rambura', 'Hanika', 3880], ['Rubengera', 'Nyamasheke', 3960],
  ['Mubuga', 'Kamembe', 4020], ['Muhanga', 'Mubuga', 4039], ['Nyarusange', 'Mugonero', 4079],
  ['Rufungo', 'Hanika', 4079], ['Nyange', 'Karengera', 4119], ['Nyabugogo', 'Rambura', 4138],
  ['Rambura', 'Kirambo', 4158], ['Muhanga', 'Gishyita', 4296], ['Rambura', 'Tyazo', 4296],
  ['Rufungo', 'Kirambo', 4376], ['Nyange', 'Hanika', 4495], ['Rufungo', 'Tyazo', 4495],
  ['Nyabugogo', 'Rubengera', 4535], ['Rambura', 'Nyamasheke', 4613], ['Muhanga', 'Mugonero', 4712],
  ['Nyarusange', 'Karengera', 4792], ['Nyange', 'Kirambo', 4792], ['Karongi', 'Kamembe', 4792],
  ['Rufungo', 'Nyamasheke', 4831], ['Nyabugogo', 'Mushubati', 4870], ['Nyange', 'Tyazo', 4911],
  ['Nyarusange', 'Hanika', 5168], ['Nyabugogo', 'Congo Nile', 5208], ['Nyange', 'Nyamasheke', 5247],
  ['Muhanga', 'Karengera', 5405], ['Rubengera', 'Kamembe', 5445], ['Nyarusange', 'Kirambo', 5465],
  ['Nyabugogo', 'Karongi', 5504], ['Nyarusange', 'Tyazo', 5584], ['Muhanga', 'Hanika', 5782],
  ['Nyarusange', 'Nyamasheke', 5920], ['Nyabugogo', 'Mubuga', 5980], ['Muhanga', 'Kirambo', 6079],
  ['Rambura', 'Kamembe', 6118], ['Muhanga', 'Tyazo', 6198], ['Nyabugogo', 'Gishyita', 6237],
  ['Rufungo', 'Kamembe', 6336], ['Muhanga', 'Nyamasheke', 6534], ['Nyabugogo', 'Mugonero', 6653],
  ['Nyange', 'Kamembe', 6752], ['Nyabugogo', 'Karengera', 7365], ['Nyarusange', 'Kamembe', 7406],
  ['Nyabugogo', 'Hanika', 7742], ['Nyabugogo', 'Kirambo', 8019], ['Nyabugogo', 'Tyazo', 8158],
  ['Nyabugogo', 'Nyamasheke', 8474], ['Muhanga', 'Kamembe', 8534], ['Nyabugogo', 'Kamembe', 10296],
  // ── Western: Nyabugogo — Muhanga — Ngororero — Rubavu ─────────────────────
  ['Gatumba', 'Ngororero', 515], ['Buringa', 'Gatumba', 712], ['Muhanga', 'Buringa', 753],
  ['Kabaya', 'Mukamira', 1069], ['Buringa', 'Ngororero', 1227], ['Ngororero', 'Kabaya', 1386],
  ['Muhanga', 'Gatumba', 1465], ['Gatumba', 'Kabaya', 1663], ['Kabaya', 'Kabali', 1822],
  ['Muhanga', 'Ngororero', 1941], ['Ngororero', 'Mukamira', 2040], ['Muhanga', 'Kibangu', 2139],
  ['Kabaya', 'Mahoko', 2237], ['Buringa', 'Kabaya', 2376], ['Kabaya', 'Rubavu', 2495],
  ['Nyabugogo', 'Buringa', 2693], ['Ngororero', 'Kabali', 2970], ['Muhanga', 'Kabaya', 3129],
  ['Ngororero', 'Mahoko', 3386], ['Nyabugogo', 'Gatumba', 3405], ['Buringa', 'Mukamira', 3544],
  ['Gatumba', 'Mukamira', 3563], ['Ngororero', 'Rubavu', 3604], ['Buringa', 'Kabali', 4197],
  ['Gatumba', 'Kabali', 4237], ['Muhanga', 'Mukamira', 4257], ['Nyabugogo', 'Ngororero', 4395],
  ['Muhanga', 'Kabali', 4950], ['Nyabugogo', 'Kabaya', 5068], ['Buringa', 'Rubavu', 5208],
  ['Gatumba', 'Rubavu', 5227], ['Muhanga', 'Mahoko', 5366], ['Muhanga', 'Rubavu', 5683],
  ['Nyabugogo', 'Mukamira', 6237],
  // ── Western: Nyabugogo — Nyabihu — Rubavu ─────────────────────────────────
  ['Kabali', 'Mahoko', 337], ['Byangabo', 'Mukamira', 377], ['Mukamira', 'Kabali', 712],
  ['Kabali', 'Rubavu', 951], ['Mukamira', 'Mahoko', 1050], ['Byangabo', 'Kabali', 1089],
  ['Byangabo', 'Mahoko', 1406], ['Mukamira', 'Rubavu', 1525], ['Rubavu', 'Bugeshi', 1861],
  ['Rubavu', 'Kabuhanga', 1980], ['Gakenke', 'Byangabo', 2000], ['Byangabo', 'Rubavu', 2040],
  ['Base', 'Byangabo', 2495], ['Base', 'Mukamira', 2871], ['Gakenke', 'Kabali', 3069],
  ['Gakenke', 'Mahoko', 3405], ['Base', 'Kabali', 3584], ['Base', 'Mahoko', 3921],
  ['Gakenke', 'Rubavu', 4020], ['Nyabugogo', 'Byangabo', 4455], ['Base', 'Rubavu', 4535],
  ['Nyabugogo', 'Mukamira', 4831], ['Musanze', 'Muhanga', 5445], ['Nyabugogo', 'Kabali', 5525],
  ['Nyabugogo', 'Mahoko', 5860], ['Nyabugogo', 'Rubavu', 6554],
  // ── Western: Rubavu — Karongi — Kamembe ───────────────────────────────────
  ['Nkomero', 'Gisiza', 257], ['Gisiza', 'Congo Nile', 416], ['Rubavu', 'Brasserie', 416],
  ['Gakeri', 'Nkomero', 574], ['Nkomero', 'Congo Nile', 653], ['Gakeri', 'Gisiza', 811],
  ['Congo Nile', 'Rubengera', 990], ['Gisiza', 'Rubengera', 1109], ['Gakeri', 'Congo Nile', 1227],
  ['Nkomero', 'Rubengera', 1367], ['Rubavu', 'Gakeri', 1604], ['Karongi', 'Birambo', 1663],
  ['Gisiza', 'Karongi', 1861], ['Gakeri', 'Rubengera', 1921], ['Congo Nile', 'Karongi', 1980],
  ['Nkomero', 'Karongi', 2099], ['Rubavu', 'Kayove', 2118], ['Rubavu', 'Nkomero', 2158],
  ['Congo Nile', 'Mubuga', 2158], ['Rubavu', 'Nkora', 2178], ['Congo Nile', 'Gishyita', 2396],
  ['Rubavu', 'Gisiza', 2416], ['Karongi', 'Gisovu', 2416], ['Gisiza', 'Mubuga', 2573],
  ['Gakeri', 'Karongi', 2674], ['Nkomero', 'Mubuga', 2812], ['Gisiza', 'Gishyita', 2812],
  ['Congo Nile', 'Mugonero', 2812], ['Rubavu', 'Congo Nile', 2832], ['Kigeyo', 'Karongi', 2970],
  ['Nkomero', 'Gishyita', 3069], ['Gisiza', 'Mugonero', 3228], ['Gakeri', 'Mubuga', 3386],
  ['Nkomero', 'Mugonero', 3485], ['Rubavu', 'Rubengera', 3524], ['Congo Nile', 'Karengera', 3524],
  ['Gakeri', 'Gishyita', 3623], ['Congo Nile', 'Hanika', 3901], ['Gisiza', 'Karengera', 3940],
  ['Pfunda', 'Karongi', 3960], ['Gakeri', 'Mugonero', 4039], ['Nkomero', 'Karengera', 4178],
  ['Congo Nile', 'Kirambo', 4197], ['Gisiza', 'Hanika', 4316], ['Congo Nile', 'Tyazo', 4316],
  ['Nkomero', 'Hanika', 4553], ['Gisiza', 'Kirambo', 4594], ['Congo Nile', 'Nyamasheke', 4652],
  ['Gisiza', 'Tyazo', 4732], ['Gakeri', 'Karengera', 4753], ['Nkomero', 'Kirambo', 4851],
  ['Rubavu', 'Karongi', 4950], ['Nkomero', 'Tyazo', 4969], ['Gisiza', 'Nyamasheke', 5068],
  ['Gakeri', 'Hanika', 5128], ['Rubavu', 'Mubuga', 5247], ['Nkomero', 'Nyamasheke', 5307],
  ['Gakeri', 'Kirambo', 5426], ['Gakeri', 'Tyazo', 5544], ['Rubavu', 'Gishyita', 5642],
  ['Gakeri', 'Nyamasheke', 5881], ['Rubavu', 'Mugonero', 5940], ['Congo Nile', 'Kamembe', 6138],
  ['Rubavu', 'Karengera', 6356], ['Gisiza', 'Kamembe', 6554], ['Rubavu', 'Hanika', 6731],
  ['Nkomero', 'Kamembe', 6811], ['Rubavu', 'Kirambo', 7029], ['Rubavu', 'Tyazo', 7147],
  ['Gakeri', 'Kamembe', 7365], ['Rubavu', 'Nyamasheke', 7721], ['Rubavu', 'Ntendezi', 7979],
  ['Rubavu', 'Kamembe', 9009],
];

// TEMP: flat 100 RWF over the REAL tariff stop-pairs only (no invented pairs).
// To restore real pricing, drop the `.map(...)` and export TARIFF_2026 directly.
const FLAT_FARE = 100;
export const PRICES: [string, string, number][] = TARIFF_2026.map(([a, b]) => [a, b, FLAT_FARE]);

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
