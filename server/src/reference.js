import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { distanceM, midpoint, wardAt as wardOfPoint } from '../../shared/geo.ts';

/**
 * Reference data: wards and the sewer network. The network starts as extracted from the plans
 * (data/processed) and has the Commissioner-approved edits (network_edits table) applied over it.
 */
function load(name) {
  return JSON.parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8'));
}

const wards = load('wards.geojson').features;
const basePipes = load('pipes.geojson').features;
const baseManholes = load('manholes.geojson').features;
// A few features of the drawings have no ward: give them the nearest ward (in memory only; files untouched).
for (const f of basePipes) if (f.properties.ward == null) f.properties.ward = wardOfPoint(midpoint(f.geometry), wards).ward;
for (const f of baseManholes) if (f.properties.ward == null) f.properties.ward = wardOfPoint(f.geometry.coordinates, wards).ward;
/** Pipes as drawn (for lengths of pipes removed later). */
export const basePipesById = new Map(basePipes.map((f) => [f.properties.id, f]));
/** The network as drawn, before any approved change (for "plan changes since the drawings"). */
export const basePlan = {
  pipe_m: basePipes.reduce((a, f) => a + (f.properties.length_m ?? 0), 0),
  pipes: basePipes.length,
  manholes: baseManholes.length,
};

const pipes = new Map();
const manholes = new Map();
let revision = 0;

function reset() {
  pipes.clear();
  manholes.clear();
  for (const f of basePipes) pipes.set(f.properties.id, f);
  for (const f of baseManholes) manholes.set(f.properties.id, f);
}
reset();

export const reference = { wards };
export const network = {
  pipes,
  manholes,
  get revision() {
    return revision;
  },
};

/** Apply one approved edit to the in-memory network. */
export function applyNetworkEdit(e) {
  const map = e.kind === 'pipe' ? pipes : manholes;
  if (e.op === 'delete') map.delete(e.feature_id);
  else map.set(e.feature_id, { type: 'Feature', id: e.feature_id, geometry: e.geometry, properties: { ...e.properties, id: e.feature_id, added: true } });
  revision++;
}

export async function loadNetworkEdits(db) {
  reset();
  const rows = (await db.query('select * from network_edits order by id')).rows;
  for (const e of rows) applyNetworkEdit(e);
  revision++;
  return rows.length;
}

export function networkCollections() {
  return {
    pipes: { type: 'FeatureCollection', features: [...pipes.values()] },
    manholes: { type: 'FeatureCollection', features: [...manholes.values()] },
  };
}

/** Ward (and its zone) containing the point, else the nearest ward (inside: false). */
export function wardAt(p) {
  return wardOfPoint(p, wards);
}

export function wardOfGeometry(g) {
  return wardAt(midpoint(g));
}

/** Distinct manholes along the given pipe reaches = manholes planned on the stretch. */
export function plannedManholes(pipeIds) {
  const mh = new Set();
  for (const id of pipeIds) {
    const p = pipes.get(id);
    if (p) {
      mh.add(p.properties.from);
      mh.add(p.properties.to);
    }
  }
  return mh.size;
}

export function knownPipes(pipeIds) {
  return pipeIds.filter((id) => pipes.has(id));
}

export function pipesAtManhole(mhId) {
  return [...pipes.values()].filter((p) => p.properties.from === mhId || p.properties.to === mhId).map((p) => p.properties.id);
}

export { distanceM };
