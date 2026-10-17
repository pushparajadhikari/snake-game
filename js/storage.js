/**
 * Persistence helpers.
 *
 * localStorage can be missing, disabled, full, or throw on access in private
 * browsing modes, so every call is wrapped and failures degrade to in-memory
 * defaults rather than breaking the game.
 */

const STORAGE_KEY = 'snake-game/v1';

const DEFAULT_SETTINGS = Object.freeze({
  difficulty: 'normal',
  walls: true,
  muted: false,
});

let memoryFallback = null;

function getStore() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    // Touch the API: some browsers only throw on first use.
    const probe = '__snake_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function isAvailable() {
  return getStore() !== null;
}

export function loadState() {
  const store = getStore();
  if (!store) return memoryFallback ? { ...memoryFallback } : {};

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch };
  const store = getStore();
  if (!store) {
    memoryFallback = next;
    return false;
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    memoryFallback = next;
    return false;
  }
}

export function loadHighScore() {
  const value = Number(loadState().highScore);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function saveHighScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0) return false;
  return saveState({ highScore: Math.floor(value) });
}

export function loadSettings() {
  const state = loadState();
  const difficulty = typeof state.difficulty === 'string' ? state.difficulty : DEFAULT_SETTINGS.difficulty;
  return {
    difficulty,
    walls: typeof state.walls === 'boolean' ? state.walls : DEFAULT_SETTINGS.walls,
    muted: typeof state.muted === 'boolean' ? state.muted : DEFAULT_SETTINGS.muted,
  };
}

export function saveSettings(settings) {
  const patch = {};
  if (typeof settings.difficulty === 'string') patch.difficulty = settings.difficulty;
  if (typeof settings.walls === 'boolean') patch.walls = settings.walls;
  if (typeof settings.muted === 'boolean') patch.muted = settings.muted;
  return saveState(patch);
}

export { DEFAULT_SETTINGS, STORAGE_KEY };
