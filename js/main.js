/**
 * Bootstrap: wires the rules, the renderer, input and persistence together and
 * runs the fixed-timestep loop.
 *
 * One animation frame loop is created for the lifetime of the page. Restarting
 * resets game state instead of starting a second loop, which keeps the tick
 * rate honest and avoids leaking frames.
 */

import { Game, GameState, DIFFICULTIES } from './game.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';
import { AudioEngine } from './audio.js';
import { loadHighScore, saveHighScore, loadSettings, saveSettings } from './storage.js';

/** Largest frame delta we will simulate, so a sleeping tab cannot burst-catch-up. */
const MAX_FRAME_DELTA = 120;
/** Hard ceiling on ticks per frame as a second line of defence. */
const MAX_TICKS_PER_FRAME = 3;

const COLS = 24;
const ROWS = 24;

const DEATH_MESSAGES = {
  wall: 'You ran into a wall.',
  self: 'You ran into your own tail.',
};

const STATUS_MESSAGES = {
  [GameState.MENU]: 'Choose a difficulty and press start.',
  [GameState.PLAYING]: 'Steer with the arrow keys, WASD, or a swipe.',
  [GameState.PAUSED]: 'Paused — press space or P to resume.',
  [GameState.GAME_OVER]: 'Press R or play again to try once more.',
  [GameState.WIN]: 'Perfect run. Press R to go again.',
};

function byId(id) {
  return document.getElementById(id);
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function prefersReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function boot() {
  const canvas = byId('board-canvas');
  const board = byId('board');
  if (!canvas || !board) return;

  const ui = {
    score: byId('score'),
    highScore: byId('high-score'),
    level: byId('level'),
    overlay: byId('overlay'),
    panels: {
      [GameState.MENU]: byId('panel-menu'),
      [GameState.PAUSED]: byId('panel-paused'),
      [GameState.GAME_OVER]: byId('panel-gameover'),
      [GameState.WIN]: byId('panel-win'),
    },
    startButton: byId('start-button'),
    resumeButton: byId('resume-button'),
    pausedRestartButton: byId('paused-restart-button'),
    restartButton: byId('restart-button'),
    menuButton: byId('menu-button'),
    winRestartButton: byId('win-restart-button'),
    winMenuButton: byId('win-menu-button'),
    pauseButton: byId('pause-button'),
    muteButton: byId('mute-button'),
    muteIcon: byId('mute-icon'),
    muteText: byId('mute-text'),
    wallsToggle: byId('walls-toggle'),
    wallsHint: byId('walls-hint'),
    difficultyInputs: Array.from(document.querySelectorAll('input[name="difficulty"]')),
    gameoverReason: byId('gameover-reason'),
    recordBadge: byId('record-badge'),
    finalScore: byId('final-score'),
    finalHighScore: byId('final-high-score'),
    finalLength: byId('final-length'),
    winScore: byId('win-score'),
    winHighScore: byId('win-high-score'),
    statusLine: byId('status-line'),
    announcer: byId('announcer'),
  };

  const settings = loadSettings();
  const storedHighScore = loadHighScore();

  const game = new Game({
    cols: COLS,
    rows: ROWS,
    difficulty: settings.difficulty,
    walls: settings.walls,
    highScore: storedHighScore,
  });

  const renderer = new Renderer(canvas, { reducedMotion: prefersReducedMotion() });
  const audio = new AudioEngine({ muted: settings.muted });

  let rafId = null;
  let lastFrame = 0;
  let accumulator = 0;
  let bumpTimer = 0;
  let resizePending = false;
  let highScoreAtStart = game.highScore;
  let scoredRecord = false;
  let syncedState = null;
  const teardown = [];

  /* ----------------------------------------------------------------- view sync */

  function announce(message) {
    if (ui.announcer) ui.announcer.textContent = message;
  }

  function bumpScore() {
    const element = ui.score;
    if (!element || renderer.reducedMotion) return;
    element.classList.remove('bump');
    // Force a reflow so the animation restarts on consecutive pickups.
    void element.offsetWidth;
    element.classList.add('bump');
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => element.classList.remove('bump'), 360);
  }

  function updateHud() {
    setText(ui.score, game.score);
    setText(ui.highScore, game.highScore);
    setText(ui.level, game.level);
  }

  function updateMuteButton() {
    if (ui.muteButton) {
      ui.muteButton.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
      ui.muteButton.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
    }
    setText(ui.muteIcon, audio.muted ? '🔇' : '🔊');
    setText(ui.muteText, audio.muted ? 'Muted' : 'Sound');
  }

  function updateWallsHint() {
    setText(ui.wallsHint, game.walls ? 'Hitting an edge ends the run' : 'Edges wrap to the other side');
  }

  function updatePauseButton() {
    const button = ui.pauseButton;
    if (!button) return;

    const playable = game.state === GameState.PLAYING || game.state === GameState.PAUSED;
    button.disabled = !playable;

    const resuming = game.state === GameState.PAUSED;
    button.setAttribute('aria-label', resuming ? 'Resume game' : 'Pause game');
    const icon = button.querySelector('span[aria-hidden="true"]');
    if (icon) icon.textContent = resuming ? '▶' : '⏸';
    const label = button.querySelector('.icon-button-text');
    if (label) label.textContent = resuming ? 'Resume' : 'Pause';
  }

  function syncOverlay() {
    const state = game.state;
    syncedState = state;

    for (const [key, panel] of Object.entries(ui.panels)) {
      if (panel) panel.hidden = key !== state;
    }

    const showOverlay = state !== GameState.PLAYING;
    if (ui.overlay) ui.overlay.classList.toggle('is-hidden', !showOverlay);

    setText(ui.statusLine, STATUS_MESSAGES[state] || '');
    updatePauseButton();

    // Move focus to the panel's primary action so keyboard users land in place.
    if (showOverlay) {
      const panel = ui.panels[state];
      const action = panel ? panel.querySelector('.primary-button') : null;
      if (action && document.activeElement !== action) {
        try {
          action.focus({ preventScroll: true });
        } catch {
          /* focus is best effort */
        }
      }
    }
  }

  function showGameOver() {
    setText(ui.gameoverReason, DEATH_MESSAGES[game.deathCause] || 'That run is over.');
    setText(ui.finalScore, game.score);
    setText(ui.finalHighScore, game.highScore);
    setText(ui.finalLength, game.snake.length);
    if (ui.recordBadge) ui.recordBadge.hidden = !scoredRecord;
    announce(`Game over. Score ${game.score}.`);
  }

  function showWin() {
    setText(ui.winScore, game.score);
    setText(ui.winHighScore, game.highScore);
    announce(`Board cleared with a score of ${game.score}.`);
  }

  /* --------------------------------------------------------------- transitions */

  function persistHighScore() {
    if (game.highScore > highScoreAtStart) {
      scoredRecord = true;
      highScoreAtStart = game.highScore;
      saveHighScore(game.highScore);
    }
  }

  function startRun() {
    audio.unlock();
    game.start();
    accumulator = 0;
    scoredRecord = false;
    highScoreAtStart = game.highScore;
    renderer.clearEffects();
    updateHud();
    syncOverlay();
    audio.start();
    announce(`${DIFFICULTIES[game.difficulty].label} game started.`);
  }

  function toMenu() {
    game.reset();
    accumulator = 0;
    renderer.clearEffects();
    updateHud();
    syncOverlay();
    announce('Main menu.');
  }

  function togglePause() {
    if (game.state === GameState.MENU || game.isOver) {
      startRun();
      return;
    }
    if (game.pause()) {
      accumulator = 0;
      announce('Paused.');
    } else if (game.resume()) {
      announce('Resumed.');
    }
    syncOverlay();
  }

  function autoPause() {
    if (game.state === GameState.PLAYING) {
      game.pause();
      accumulator = 0;
      syncOverlay();
    }
  }

  function toggleMute() {
    audio.unlock();
    audio.toggleMute();
    saveSettings({ muted: audio.muted });
    updateMuteButton();
    announce(audio.muted ? 'Sound muted.' : 'Sound on.');
  }

  /* -------------------------------------------------------------- game events */

  function handleEvents(events) {
    for (const event of events) {
      switch (event.type) {
        case 'eat': {
          const color = event.kind === 'bonus' ? '#fbbf24' : '#f87171';
          renderer.addBurst(event.cell.x, event.cell.y, color, event.kind === 'bonus' ? 18 : 10);
          if (event.kind === 'bonus') audio.bonus();
          else audio.eat();
          updateHud();
          bumpScore();
          break;
        }
        case 'level':
          audio.level();
          updateHud();
          announce(`Level ${event.level}.`);
          break;
        case 'bonus-spawn':
          announce('Bonus food appeared.');
          break;
        case 'death':
          audio.die();
          persistHighScore();
          updateHud();
          showGameOver();
          syncOverlay();
          break;
        case 'win':
          audio.win();
          persistHighScore();
          updateHud();
          showWin();
          syncOverlay();
          break;
        default:
          break;
      }
    }
  }

  /* ------------------------------------------------------------------ the loop */

  function frame(now) {
    rafId = requestAnimationFrame(frame);

    let delta = now - lastFrame;
    lastFrame = now;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    delta = Math.min(delta, MAX_FRAME_DELTA);

    if (game.state === GameState.PLAYING) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= game.tickInterval && steps < MAX_TICKS_PER_FRAME) {
        accumulator -= game.tickInterval;
        steps += 1;
        handleEvents(game.tick());
        if (game.state !== GameState.PLAYING) {
          accumulator = 0;
          break;
        }
      }
      // Drop any leftover backlog rather than replaying it later.
      if (accumulator > game.tickInterval) accumulator = game.tickInterval;
    } else {
      accumulator = 0;
    }

    // Safety net: the overlay follows the state machine even if a transition
    // ever happens without an event to react to.
    if (game.state !== syncedState) syncOverlay();

    const progress = game.tickInterval > 0 ? accumulator / game.tickInterval : 0;
    renderer.draw(game, { progress, dt: delta });
  }

  function startLoop() {
    if (rafId !== null) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ------------------------------------------------------------------- wiring */

  function on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    teardown.push(() => {
      try {
        target.removeEventListener(type, handler, options);
      } catch {
        /* target already gone */
      }
    });
  }

  const input = new InputController({
    keyTarget: window,
    swipeTarget: board,
    padTarget: byId('dpad'),
    onGesture: () => audio.unlock(),
    onDirection: (direction) => {
      if (game.state === GameState.MENU) {
        startRun();
        game.enqueueDirection(direction);
        return;
      }
      if (game.state === GameState.PAUSED) return;
      game.enqueueDirection(direction);
    },
    onPause: togglePause,
    onRestart: startRun,
    onMute: toggleMute,
  });
  teardown.push(() => input.dispose());

  on(ui.startButton, 'click', startRun);
  on(ui.resumeButton, 'click', togglePause);
  on(ui.pausedRestartButton, 'click', startRun);
  on(ui.restartButton, 'click', startRun);
  on(ui.winRestartButton, 'click', startRun);
  on(ui.menuButton, 'click', toMenu);
  on(ui.winMenuButton, 'click', toMenu);
  on(ui.pauseButton, 'click', togglePause);
  on(ui.muteButton, 'click', toggleMute);

  for (const radio of ui.difficultyInputs) {
    radio.checked = radio.value === game.difficulty;
    on(radio, 'change', () => {
      if (!radio.checked) return;
      if (game.setDifficulty(radio.value)) {
        saveSettings({ difficulty: game.difficulty });
        updateHud();
        announce(`${DIFFICULTIES[game.difficulty].label} difficulty selected.`);
      }
    });
  }

  if (ui.wallsToggle) {
    ui.wallsToggle.checked = game.walls;
    on(ui.wallsToggle, 'change', () => {
      game.setWalls(ui.wallsToggle.checked);
      saveSettings({ walls: game.walls });
      updateWallsHint();
      announce(game.walls ? 'Solid walls on.' : 'Wrap-around on.');
    });
  }

  /* --------------------------------------------------- lifecycle and resizing */

  function requestResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      renderer.resize();
    });
  }

  on(window, 'resize', requestResize);
  on(window, 'orientationchange', requestResize);

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(requestResize);
    try {
      observer.observe(board);
      teardown.push(() => observer.disconnect());
    } catch {
      /* fall back to the window resize listener */
    }
  }

  on(document, 'visibilitychange', () => {
    if (document.hidden) autoPause();
    else audio.resume();
  });
  on(window, 'blur', autoPause);

  const motionQuery = globalThis.matchMedia ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (motionQuery) {
    const onMotionChange = (event) => renderer.setReducedMotion(event.matches);
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', onMotionChange);
      teardown.push(() => motionQuery.removeEventListener('change', onMotionChange));
    }
  }

  on(window, 'pagehide', () => {
    stopLoop();
    clearTimeout(bumpTimer);
    for (const dispose of teardown.splice(0)) {
      try {
        dispose();
      } catch {
        /* keep tearing down the rest */
      }
    }
    audio.dispose();
  });

  /* -------------------------------------------------------------------- start */

  renderer.resize();
  updateHud();
  updateMuteButton();
  updateWallsHint();
  syncOverlay();
  startLoop();
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
} catch (error) {
  const status = document.getElementById('status-line');
  if (status) status.textContent = 'The game failed to start in this browser.';
  // Surface the cause for debugging without leaving an unhandled rejection.
  console.error('Snake failed to start:', error);
}
