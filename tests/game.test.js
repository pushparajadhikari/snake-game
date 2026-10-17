import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, GameState, DIFFICULTIES, VECTORS, MAX_QUEUED_TURNS, isOpposite } from '../js/game.js';

/** Starts a game with the food parked somewhere harmless. */
function playing(options = {}) {
  const game = new Game({ cols: 10, rows: 10, rng: () => 0, ...options });
  game.start();
  game.food = { x: game.cols - 1, y: game.rows - 1 };
  return game;
}

/** Drops food directly in front of the head and ticks into it. */
function feed(game) {
  const head = game.snake[0];
  const vector = VECTORS[game.direction];
  game.food = { x: head.x + vector.x, y: head.y + vector.y };
  return game.tick();
}

function occupies(game, cell) {
  return game.snake.some((segment) => segment.x === cell.x && segment.y === cell.y);
}

test('a new game starts in the menu with a centred snake', () => {
  const game = new Game({ cols: 24, rows: 24 });

  assert.equal(game.state, GameState.MENU);
  assert.equal(game.snake.length, 3);
  assert.deepEqual(game.snake[0], { x: 12, y: 12 });
  assert.deepEqual(game.snake[2], { x: 10, y: 12 });
  assert.equal(game.direction, 'right');
  assert.equal(game.score, 0);
  assert.equal(game.level, 1);
});

test('tick is a no-op unless the game is playing', () => {
  const game = new Game({ cols: 10, rows: 10 });
  const before = JSON.stringify(game.snake);

  assert.deepEqual(game.tick(), []);
  assert.equal(JSON.stringify(game.snake), before);

  game.start();
  game.pause();
  assert.deepEqual(game.tick(), []);
  assert.equal(JSON.stringify(game.snake), before);
});

test('the snake advances one cell per tick without changing length', () => {
  const game = playing();

  game.tick();
  assert.deepEqual(game.snake[0], { x: 6, y: 5 });
  assert.equal(game.snake.length, 3);

  game.enqueueDirection('down');
  game.tick();
  assert.deepEqual(game.snake[0], { x: 6, y: 6 });
  assert.equal(game.direction, 'down');
  assert.equal(game.snake.length, 3);
});

test('eating food grows the snake, scores points and respawns food', () => {
  const game = playing();
  const events = feed(game);

  assert.equal(game.snake.length, 4);
  assert.equal(game.score, DIFFICULTIES.normal.foodPoints);
  assert.equal(game.foodsEaten, 1);
  assert.ok(game.food, 'new food is placed');
  assert.ok(!occupies(game, game.food), 'new food is not under the snake');

  const eaten = events.find((event) => event.type === 'eat');
  assert.equal(eaten.kind, 'food');
  assert.deepEqual(eaten.cell, { x: 6, y: 5 });
});

test('the high score follows the score upwards only', () => {
  const game = playing({ highScore: 25 });

  feed(game);
  assert.equal(game.highScore, 25, 'a small score does not lower the record');

  for (let i = 0; i < 3; i += 1) feed(game);
  assert.equal(game.score, 40);
  assert.equal(game.highScore, 40);
});

test('hitting a wall ends the game when walls are solid', () => {
  const game = playing({ walls: true });

  for (let i = 0; i < 4; i += 1) game.tick();
  assert.equal(game.state, GameState.PLAYING);
  assert.deepEqual(game.snake[0], { x: 9, y: 5 });

  const events = game.tick();
  assert.equal(game.state, GameState.GAME_OVER);
  assert.equal(game.deathCause, 'wall');
  assert.deepEqual(game.snake[0], { x: 9, y: 5 }, 'the snake stops at the wall');
  assert.deepEqual(events.at(-1), { type: 'death', cause: 'wall' });
});

test('the snake wraps around every edge when walls are off', () => {
  const game = playing({ walls: false });

  for (let i = 0; i < 5; i += 1) game.tick();
  assert.equal(game.state, GameState.PLAYING);
  assert.deepEqual(game.snake[0], { x: 0, y: 5 });

  game.enqueueDirection('up');
  for (let i = 0; i < 6; i += 1) game.tick();
  assert.deepEqual(game.snake[0], { x: 0, y: 9 });
  assert.equal(game.state, GameState.PLAYING);
});

test('running into the body ends the game', () => {
  const game = playing({ initialLength: 5 });

  game.enqueueDirection('up');
  game.tick();
  game.enqueueDirection('left');
  game.tick();
  game.enqueueDirection('down');
  const events = game.tick();

  assert.equal(game.state, GameState.GAME_OVER);
  assert.equal(game.deathCause, 'self');
  assert.ok(events.some((event) => event.type === 'death'));
});

test('moving into the cell the tail is vacating is legal', () => {
  const game = playing({ initialLength: 1 });
  game.snake = [
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ];
  game.prevSnake = game.snake.map((c) => ({ ...c }));
  game.direction = 'right';

  game.enqueueDirection('down');
  game.tick();

  assert.equal(game.state, GameState.PLAYING);
  assert.deepEqual(game.snake[0], { x: 2, y: 2 });
  assert.equal(game.snake.length, 4);
});

test('a direct reversal is rejected', () => {
  const game = playing();

  assert.equal(game.enqueueDirection('left'), false);
  assert.deepEqual(game.queue, []);

  game.tick();
  assert.equal(game.direction, 'right');
  assert.deepEqual(game.snake[0], { x: 6, y: 5 });
});

test('two turns inside one tick cannot fold the snake back on itself', () => {
  const game = playing();

  assert.equal(game.enqueueDirection('up'), true);
  assert.equal(game.enqueueDirection('down'), false, 'down reverses the queued up turn');
  assert.deepEqual(game.queue, ['up']);

  // A legal quarter turn after a queued turn is still accepted.
  assert.equal(game.enqueueDirection('left'), true);
  assert.deepEqual(game.queue, ['up', 'left']);

  game.tick();
  assert.equal(game.direction, 'up');
  assert.deepEqual(game.snake[0], { x: 5, y: 4 });

  game.tick();
  assert.equal(game.direction, 'left');
  assert.deepEqual(game.snake[0], { x: 4, y: 4 });
  assert.equal(game.state, GameState.PLAYING);
});

test('the input queue holds at most two turns and ignores duplicates', () => {
  const game = playing();

  assert.equal(game.enqueueDirection('up'), true);
  assert.equal(game.enqueueDirection('up'), false, 'duplicate of the queued turn');
  assert.equal(game.enqueueDirection('left'), true);
  assert.equal(game.enqueueDirection('down'), false, 'queue is full');
  assert.equal(game.queue.length, MAX_QUEUED_TURNS);

  assert.equal(game.enqueueDirection('sideways'), false, 'unknown direction');
  assert.equal(game.queue.length, MAX_QUEUED_TURNS);
});

test('turns are not accepted from the menu or after a game over', () => {
  const game = new Game({ cols: 10, rows: 10 });
  assert.equal(game.enqueueDirection('up'), false);

  game.start();
  game.die('wall');
  assert.equal(game.enqueueDirection('up'), false);
});

test('isOpposite identifies reversals only', () => {
  assert.equal(isOpposite('up', 'down'), true);
  assert.equal(isOpposite('left', 'right'), true);
  assert.equal(isOpposite('up', 'left'), false);
  assert.equal(isOpposite('up', 'up'), false);
});

test('food is never placed on the snake', () => {
  const game = new Game({ cols: 6, rows: 6, initialLength: 1 });

  // Fill 30 of the 36 cells, leaving six free.
  game.snake = [];
  for (let i = 0; i < 30; i += 1) {
    game.snake.push({ x: i % 6, y: Math.floor(i / 6) });
  }

  for (let i = 0; i < 500; i += 1) {
    const cell = game.randomFreeCell();
    assert.ok(cell, 'a free cell exists');
    assert.ok(cell.x >= 0 && cell.x < 6 && cell.y >= 0 && cell.y < 6, 'cell is on the board');
    assert.ok(!occupies(game, cell), `cell ${JSON.stringify(cell)} overlaps the snake`);
  }
});

test('bonus food is never placed on the snake or on the food', () => {
  const game = playing({ cols: 5, rows: 5, initialLength: 1 });
  game.rng = Math.random;
  game.snake = [];
  for (let i = 0; i < 20; i += 1) {
    game.snake.push({ x: i % 5, y: Math.floor(i / 5) });
  }
  game.food = { x: 0, y: 4 };

  for (let i = 0; i < 300; i += 1) {
    const cell = game.randomFreeCell([game.food]);
    assert.ok(cell && !occupies(game, cell));
    assert.ok(!(cell.x === game.food.x && cell.y === game.food.y), 'bonus avoids the food cell');
  }
});

test('a full board reports no free cells instead of searching forever', () => {
  const game = new Game({ cols: 3, rows: 3, initialLength: 1 });
  game.snake = [];
  for (let i = 0; i < 9; i += 1) {
    game.snake.push({ x: i % 3, y: Math.floor(i / 3) });
  }

  assert.deepEqual(game.freeCells(), []);
  assert.equal(game.randomFreeCell(), null);
});

test('filling the board wins the game', () => {
  const game = new Game({ cols: 3, rows: 2, initialLength: 1 });
  game.start();

  // A snake covering five of six cells, with the last cell straight ahead.
  game.snake = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  game.prevSnake = game.snake.map((c) => ({ ...c }));
  game.direction = 'left';
  game.food = { x: 0, y: 1 };

  const events = game.tick();

  assert.equal(game.state, GameState.WIN);
  assert.equal(game.snake.length, game.cellCount);
  assert.equal(game.food, null);
  assert.ok(events.some((event) => event.type === 'win'));
  assert.deepEqual(game.tick(), [], 'the game stops advancing once won');
});

test('score and level climb with the number of foods eaten', () => {
  const game = playing({ cols: 24, rows: 24, difficulty: 'normal' });
  const config = DIFFICULTIES.normal;

  for (let i = 0; i < config.foodsPerLevel - 1; i += 1) feed(game);
  assert.equal(game.level, 1);
  assert.equal(game.tickInterval, config.baseInterval);

  const events = feed(game);
  assert.equal(game.level, 2);
  assert.equal(game.score, config.foodPoints * config.foodsPerLevel);
  assert.equal(game.tickInterval, config.baseInterval - config.intervalStep);
  assert.ok(events.some((event) => event.type === 'level' && event.level === 2));
});

test('speed increases with level but is capped', () => {
  const game = playing();
  const config = DIFFICULTIES.normal;

  assert.equal(game.levelFor(0), 1);
  assert.equal(game.levelFor(config.foodsPerLevel * 3), 4);
  assert.equal(game.levelFor(100000), game.maxLevel, 'level is capped');

  game.level = game.maxLevel;
  assert.equal(game.tickInterval, config.minInterval);

  game.level = game.maxLevel + 50;
  assert.equal(game.tickInterval, config.minInterval, 'interval never drops below the cap');
});

test('each difficulty is faster than the last and stays within its own bounds', () => {
  const order = ['easy', 'normal', 'hard'];
  for (let i = 1; i < order.length; i += 1) {
    const slower = DIFFICULTIES[order[i - 1]];
    const faster = DIFFICULTIES[order[i]];
    assert.ok(faster.baseInterval < slower.baseInterval);
    assert.ok(faster.minInterval < slower.minInterval);
  }

  for (const name of order) {
    const game = new Game({ difficulty: name });
    assert.equal(game.tickInterval, DIFFICULTIES[name].baseInterval);
    game.level = 999;
    assert.equal(game.tickInterval, DIFFICULTIES[name].minInterval);
  }
});

test('an unknown difficulty falls back to normal', () => {
  const game = new Game({ difficulty: 'nightmare' });
  assert.equal(game.difficulty, 'normal');
  assert.equal(game.setDifficulty('nightmare'), false);
  assert.equal(game.setDifficulty('hard'), true);
  assert.equal(game.difficulty, 'hard');
});

test('a bonus appears on schedule and expires on its timer', () => {
  // rng always rolls 0: below bonusChance, so the bonus always spawns.
  const game = playing({ cols: 24, rows: 24, rng: () => 0, walls: false });
  const config = DIFFICULTIES.normal;

  let spawn = null;
  for (let i = 0; i < config.bonusEvery; i += 1) {
    const events = feed(game);
    spawn = events.find((event) => event.type === 'bonus-spawn') || spawn;
  }

  assert.ok(spawn, 'a bonus spawned after the scheduled number of foods');
  assert.ok(game.bonus, 'the bonus is on the board');
  assert.ok(!occupies(game, game.bonus), 'the bonus is not under the snake');
  assert.equal(game.bonusTicksLeft, config.bonusLifetime - 1, 'the timer starts counting immediately');

  game.bonusTicksLeft = 1;
  const events = game.tick();
  assert.equal(game.bonus, null);
  assert.ok(events.some((event) => event.type === 'bonus-expire'));
});

test('a bonus never spawns when the roll is above the chance', () => {
  // Every roll lands above every difficulty's bonus chance.
  const game = playing({ cols: 24, rows: 24, rng: () => 0.99, walls: false });

  for (let i = 0; i < DIFFICULTIES.normal.bonusEvery * 2; i += 1) feed(game);
  assert.equal(game.bonus, null);
});

test('eating a bonus pays extra points without growing the snake', () => {
  const game = playing();
  const config = DIFFICULTIES.normal;

  const head = game.snake[0];
  game.bonus = { x: head.x + 1, y: head.y };
  game.bonusLifetime = config.bonusLifetime;
  game.bonusTicksLeft = config.bonusLifetime;

  const length = game.snake.length;
  const events = game.tick();

  assert.equal(game.score, config.bonusPoints);
  assert.equal(game.snake.length, length, 'bonus food is points only');
  assert.equal(game.bonus, null);
  assert.equal(game.foodsEaten, 0, 'a bonus does not count towards the level');

  const eaten = events.find((event) => event.type === 'eat');
  assert.equal(eaten.kind, 'bonus');
  assert.equal(eaten.points, config.bonusPoints);
});

test('pause, resume and restart move through the expected states', () => {
  const game = playing();

  assert.equal(game.pause(), true);
  assert.equal(game.state, GameState.PAUSED);
  assert.equal(game.pause(), false);
  assert.equal(game.resume(), true);
  assert.equal(game.state, GameState.PLAYING);
  assert.equal(game.togglePause(), true);
  assert.equal(game.state, GameState.PAUSED);

  feed(game);
  game.resume();
  feed(game);
  assert.ok(game.score > 0);

  game.start();
  assert.equal(game.state, GameState.PLAYING);
  assert.equal(game.score, 0);
  assert.equal(game.snake.length, 3);
  assert.equal(game.foodsEaten, 0);
  assert.equal(game.level, 1);
  assert.deepEqual(game.queue, []);
});

test('reset returns to the menu and keeps the high score', () => {
  const game = playing();
  for (let i = 0; i < 3; i += 1) feed(game);
  const best = game.highScore;

  game.reset();
  assert.equal(game.state, GameState.MENU);
  assert.equal(game.score, 0);
  assert.equal(game.highScore, best);
  assert.ok(game.food, 'the menu board still shows food');
});

test('board dimensions and starting length are clamped to something playable', () => {
  const tiny = new Game({ cols: 0, rows: -5, initialLength: 99 });
  assert.equal(tiny.cols, 2);
  assert.equal(tiny.rows, 2);
  assert.ok(tiny.initialLength >= 1 && tiny.initialLength <= 2);
  assert.ok(tiny.snake.every((cell) => cell.x >= 0 && cell.y >= 0));

  const bogus = new Game({ cols: Number.NaN, rows: undefined });
  assert.equal(bogus.cols, 24);
  assert.equal(bogus.rows, 24);
});

test('a misbehaving rng cannot place food off the board', () => {
  for (const roll of [-1, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const game = new Game({ cols: 8, rows: 8, rng: () => roll });
    assert.ok(game.food, `rng ${roll} still produced food`);
    assert.ok(game.food.x >= 0 && game.food.x < 8);
    assert.ok(game.food.y >= 0 && game.food.y < 8);
    assert.ok(!occupies(game, game.food));
  }
});

test('the snapshot is a detached copy of the board', () => {
  const game = playing();
  const snapshot = game.getSnapshot();

  assert.equal(snapshot.state, GameState.PLAYING);
  assert.equal(snapshot.cols, 10);
  assert.equal(snapshot.direction, 'right');
  assert.deepEqual(snapshot.snake[0], { x: 5, y: 5 });

  snapshot.snake[0].x = 99;
  snapshot.food.x = 99;
  assert.deepEqual(game.snake[0], { x: 5, y: 5 }, 'mutating the snapshot leaves the game alone');
  assert.equal(game.food.x, 9);
});
