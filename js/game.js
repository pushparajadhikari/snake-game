/**
 * Snake game rules.
 *
 * This module is deliberately free of DOM, canvas and timer access so the rules
 * can be unit tested in Node and driven by any renderer. Everything that varies
 * between environments (randomness, board size, difficulty) is injected.
 */

export const GameState = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameover',
  WIN: 'win',
});

export const Direction = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
});

export const VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

const OPPOSITES = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
});

/**
 * Interval values are milliseconds per tick. The interval shrinks by
 * intervalStep per level and is clamped at minInterval, which is what caps the
 * top speed.
 */
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    label: 'Easy',
    baseInterval: 170,
    minInterval: 105,
    intervalStep: 8,
    foodsPerLevel: 5,
    foodPoints: 10,
    bonusPoints: 50,
    bonusEvery: 4,
    bonusChance: 0.7,
    bonusLifetime: 60,
  }),
  normal: Object.freeze({
    label: 'Normal',
    baseInterval: 130,
    minInterval: 70,
    intervalStep: 6,
    foodsPerLevel: 4,
    foodPoints: 10,
    bonusPoints: 50,
    bonusEvery: 4,
    bonusChance: 0.6,
    bonusLifetime: 45,
  }),
  hard: Object.freeze({
    label: 'Hard',
    baseInterval: 95,
    minInterval: 50,
    intervalStep: 5,
    foodsPerLevel: 3,
    foodPoints: 15,
    bonusPoints: 75,
    bonusEvery: 3,
    bonusChance: 0.55,
    bonusLifetime: 35,
  }),
});

/** At most two turns may be buffered, so a fast double tap cannot queue a U-turn. */
export const MAX_QUEUED_TURNS = 2;

const DEFAULTS = Object.freeze({
  cols: 24,
  rows: 24,
  difficulty: 'normal',
  walls: true,
  initialLength: 3,
  highScore: 0,
});

export function isOpposite(a, b) {
  return OPPOSITES[a] === b;
}

function toInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class Game {
  constructor(options = {}) {
    const opts = { ...DEFAULTS, ...options };

    this.cols = clamp(toInt(opts.cols, DEFAULTS.cols), 2, 400);
    this.rows = clamp(toInt(opts.rows, DEFAULTS.rows), 2, 400);
    this.rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    this.difficulty = DIFFICULTIES[opts.difficulty] ? opts.difficulty : DEFAULTS.difficulty;
    this.walls = Boolean(opts.walls);
    this.highScore = Math.max(0, toInt(opts.highScore, 0));

    const maxStart = Math.floor(this.cols / 2) + 1;
    this.initialLength = clamp(toInt(opts.initialLength, DEFAULTS.initialLength), 1, maxStart);

    this.reset();
  }

  get config() {
    return DIFFICULTIES[this.difficulty];
  }

  get cellCount() {
    return this.cols * this.rows;
  }

  /** Highest reachable level, i.e. the level at which minInterval is hit. */
  get maxLevel() {
    const c = this.config;
    const span = Math.max(0, c.baseInterval - c.minInterval);
    return 1 + Math.ceil(span / c.intervalStep);
  }

  /** Milliseconds the caller should wait between tick() calls. */
  get tickInterval() {
    const c = this.config;
    return Math.max(c.minInterval, c.baseInterval - (this.level - 1) * c.intervalStep);
  }

  get isOver() {
    return this.state === GameState.GAME_OVER || this.state === GameState.WIN;
  }

  setDifficulty(name) {
    if (DIFFICULTIES[name]) {
      this.difficulty = name;
      return true;
    }
    return false;
  }

  setWalls(enabled) {
    this.walls = Boolean(enabled);
  }

  /** Returns the board to its opening position and the state machine to MENU. */
  reset() {
    this.state = GameState.MENU;
    this.score = 0;
    this.foodsEaten = 0;
    this.level = 1;
    this.ticks = 0;
    this.direction = Direction.RIGHT;
    this.queue = [];
    this.deathCause = null;
    this.bonus = null;
    this.bonusTicksLeft = 0;
    this.bonusLifetime = this.config.bonusLifetime;

    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    this.snake = [];
    for (let i = 0; i < this.initialLength; i += 1) {
      this.snake.push({ x: cx - i, y: cy });
    }
    this.prevSnake = this.snake.map((c) => ({ x: c.x, y: c.y }));

    this.food = this.randomFreeCell();
    return this;
  }

  /** Resets and begins play. */
  start() {
    this.reset();
    this.state = GameState.PLAYING;
    return this;
  }

  pause() {
    if (this.state === GameState.PLAYING) {
      this.state = GameState.PAUSED;
      return true;
    }
    return false;
  }

  resume() {
    if (this.state === GameState.PAUSED) {
      this.state = GameState.PLAYING;
      return true;
    }
    return false;
  }

  togglePause() {
    return this.pause() || this.resume();
  }

  cellKey(cell) {
    return cell.y * this.cols + cell.x;
  }

  /** Every cell not covered by the snake or by any cell in extra. */
  freeCells(extra = []) {
    const occupied = new Set();
    for (const segment of this.snake) occupied.add(this.cellKey(segment));
    for (const cell of extra) {
      if (cell) occupied.add(this.cellKey(cell));
    }

    const cells = [];
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (!occupied.has(y * this.cols + x)) cells.push({ x, y });
      }
    }
    return cells;
  }

  /**
   * Picks a uniformly random free cell, or null when the board is full. Choosing
   * from the list of free cells (instead of retrying random guesses) keeps this
   * bounded even when a single cell is left.
   */
  randomFreeCell(extra = []) {
    const cells = this.freeCells(extra);
    if (cells.length === 0) return null;

    const roll = Number(this.rng());
    const safeRoll = Number.isFinite(roll) ? clamp(roll, 0, 0.999999999) : 0;
    return cells[Math.floor(safeRoll * cells.length)];
  }

  /**
   * Buffers a turn. Rejects reversals and duplicates relative to the last
   * queued turn, so two keys pressed inside a single tick can never fold the
   * snake back onto itself.
   */
  enqueueDirection(direction) {
    if (!VECTORS[direction]) return false;
    if (this.state !== GameState.PLAYING && this.state !== GameState.PAUSED) return false;
    if (this.queue.length >= MAX_QUEUED_TURNS) return false;

    const reference = this.queue.length > 0 ? this.queue[this.queue.length - 1] : this.direction;
    if (direction === reference || isOpposite(direction, reference)) return false;

    this.queue.push(direction);
    return true;
  }

  levelFor(foodsEaten) {
    const perLevel = Math.max(1, this.config.foodsPerLevel);
    return clamp(1 + Math.floor(foodsEaten / perLevel), 1, this.maxLevel);
  }

  /**
   * Advances the simulation by one step and returns the events that occurred,
   * so the caller can drive sound and particles without diffing state.
   */
  tick() {
    const events = [];
    if (this.state !== GameState.PLAYING) return events;

    this.ticks += 1;
    this.prevSnake = this.snake.map((c) => ({ x: c.x, y: c.y }));

    if (this.queue.length > 0) this.direction = this.queue.shift();

    const vector = VECTORS[this.direction];
    let x = this.snake[0].x + vector.x;
    let y = this.snake[0].y + vector.y;

    const outOfBounds = x < 0 || x >= this.cols || y < 0 || y >= this.rows;
    if (outOfBounds) {
      if (this.walls) return this.die('wall', events);
      x = ((x % this.cols) + this.cols) % this.cols;
      y = ((y % this.rows) + this.rows) % this.rows;
      events.push({ type: 'wrap' });
    }

    const ateFood = Boolean(this.food && this.food.x === x && this.food.y === y);
    const ateBonus = Boolean(this.bonus && this.bonus.x === x && this.bonus.y === y);

    // The tail vacates its cell on a non-growing tick, so moving into it is legal.
    const checkUntil = ateFood ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < checkUntil; i += 1) {
      if (this.snake[i].x === x && this.snake[i].y === y) return this.die('self', events);
    }

    this.snake.unshift({ x, y });
    if (!ateFood) this.snake.pop();
    events.push({ type: 'move' });

    if (ateBonus) {
      const points = this.config.bonusPoints;
      this.score += points;
      this.bonus = null;
      this.bonusTicksLeft = 0;
      events.push({ type: 'eat', kind: 'bonus', cell: { x, y }, points });
    }

    if (ateFood) {
      const points = this.config.foodPoints;
      this.score += points;
      this.foodsEaten += 1;
      this.food = null;
      events.push({ type: 'eat', kind: 'food', cell: { x, y }, points });

      const level = this.levelFor(this.foodsEaten);
      if (level !== this.level) {
        this.level = level;
        events.push({ type: 'level', level });
      }

      if (this.snake.length >= this.cellCount) return this.win(events);

      this.food = this.randomFreeCell([this.bonus]);
      if (!this.food) return this.win(events);

      const spawnDue = this.foodsEaten % Math.max(1, this.config.bonusEvery) === 0;
      if (!this.bonus && spawnDue && Number(this.rng()) < this.config.bonusChance) {
        const cell = this.randomFreeCell([this.food]);
        if (cell) {
          this.bonus = cell;
          this.bonusLifetime = this.config.bonusLifetime;
          this.bonusTicksLeft = this.bonusLifetime;
          events.push({ type: 'bonus-spawn', cell });
        }
      }
    }

    if (this.bonus) {
      this.bonusTicksLeft -= 1;
      if (this.bonusTicksLeft <= 0) {
        const cell = this.bonus;
        this.bonus = null;
        this.bonusTicksLeft = 0;
        events.push({ type: 'bonus-expire', cell });
      }
    }

    this.syncHighScore();
    return events;
  }

  die(cause, events = []) {
    this.state = GameState.GAME_OVER;
    this.deathCause = cause;
    this.queue = [];
    this.syncHighScore();
    events.push({ type: 'death', cause });
    return events;
  }

  win(events = []) {
    this.state = GameState.WIN;
    this.food = null;
    this.bonus = null;
    this.bonusTicksLeft = 0;
    this.queue = [];
    this.syncHighScore();
    events.push({ type: 'win' });
    return events;
  }

  syncHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      return true;
    }
    return false;
  }

  /** Plain, detached copy of everything a view needs. */
  getSnapshot() {
    return {
      state: this.state,
      cols: this.cols,
      rows: this.rows,
      walls: this.walls,
      difficulty: this.difficulty,
      direction: this.direction,
      snake: this.snake.map((c) => ({ x: c.x, y: c.y })),
      prevSnake: this.prevSnake.map((c) => ({ x: c.x, y: c.y })),
      food: this.food ? { ...this.food } : null,
      bonus: this.bonus ? { ...this.bonus } : null,
      bonusTicksLeft: this.bonusTicksLeft,
      bonusLifetime: this.bonusLifetime,
      score: this.score,
      highScore: this.highScore,
      level: this.level,
      maxLevel: this.maxLevel,
      foodsEaten: this.foodsEaten,
      ticks: this.ticks,
      tickInterval: this.tickInterval,
      deathCause: this.deathCause,
    };
  }
}
