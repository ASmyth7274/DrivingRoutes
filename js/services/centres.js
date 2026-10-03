// Test centres: built-in ones from data/centres plus any the user adds.

import {
  getCustomCentres, getCustomRoutes, getHiddenRoutes,
} from '../lib/storage.js';

let builtIn = null;

export async function loadBuiltInCentres() {
  if (builtIn) return builtIn;
  try {
    const res = await fetch('data/centres/index.json', { cache: 'no-cache' });
    const index = await res.json();
    const list = await Promise.all(index.centres.map(async (c) => {
      try {
        const r = await fetch(`data/centres/${c.file}`, { cache: 'no-cache' });
        const centre = await r.json();
        return { ...centre, builtIn: true };
      } catch (err) {
        console.warn('Could not load centre', c.file, err);
        return null;
      }
    }));
    builtIn = list.filter(Boolean);
  } catch (err) {
    console.error('Could not load built-in centres', err);
    builtIn = [];
  }
  return builtIn;
}

export function allCentres() {
  return [...(builtIn || []), ...getCustomCentres().map((c) => ({ ...c, custom: true }))];
}

export function findCentre(id) {
  return allCentres().find((c) => c.id === id) || null;
}

/** All routes for a centre: built-in, then user-made. Hidden ones are flagged. */
export function routesFor(centre, { includeHidden = false } = {}) {
  if (!centre) return [];
  const hidden = new Set(getHiddenRoutes(centre.id));
  const custom = getCustomRoutes(centre.id).map((r) => ({ ...r, custom: true }));
  const all = [...(centre.routes || []).map((r) => ({ ...r, builtIn: !!centre.builtIn })), ...custom]
    .map((r) => ({ ...r, hidden: hidden.has(r.id) }));
  return includeHidden ? all : all.filter((r) => !r.hidden);
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
