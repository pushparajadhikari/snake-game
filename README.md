# Snake

A grid-based Snake game written in plain HTML, CSS and JavaScript, drawn on a
canvas. No frameworks, no bundler, no runtime dependencies — open `index.html`
and play.

The interesting part is not the snake, it's the structure. The rules live in a
single pure module with no access to the DOM, the canvas or timers, which is
what makes them straightforward to unit test. Rendering, input, audio and
persistence are separate modules layered on top.

## Features

- **Fixed-timestep loop** driven by `requestAnimationFrame`, so the snake moves
  at the same speed on a 60 Hz laptop and a 165 Hz monitor. Frame deltas are
  capped, so a tab that slept for ten minutes does not wake up and replay ten
  minutes of ticks.
- **Input queue** holding up to two buffered turns. Reversals are rejected
  against the last *queued* turn, not just the current direction, so mashing
  two keys inside one tick can never fold the snake into itself.
- **Difficulty levels** (Easy / Normal / Hard) and a walls toggle: die on the
  edge, or wrap around to the other side.
- **Levels and speed** that ramp up every few foods and stop at a cap, so the
  game gets harder without becoming unplayable.
- **Bonus food** that appears on a schedule, shows a countdown ring, pays extra
  points and vanishes if you are too slow.
- **A win condition.** Fill every square on the board and the game ends in your
  favour instead of hunting forever for a free cell to put food in.
- **Persistent high score** and remembered settings via `localStorage`, with
  every access guarded so private-mode browsers degrade quietly.
- **Rendering touches**: rounded gradient body, eyes that follow the direction
  of travel, a subtle grid, particle burst and flash when eating, and a
  devicePixelRatio-aware canvas so nothing looks soft on a retina screen.
- **Accessible by default**: real form controls in the menu, visible focus
  rings, labelled buttons, a polite live region for state changes, and full
  respect for `prefers-reduced-motion`.
- **Plays nicely with the browser**: auto-pauses when the tab is hidden or the
  window loses focus, handles resize and orientation changes, and cleans up its
  listeners and animation frame when the page goes away.

## Controls

| Action        | Keyboard                        | Touch                        |
| ------------- | ------------------------------- | ---------------------------- |
| Move          | Arrow keys or <kbd>W/A/S/D</kbd> | Swipe the board, or the D-pad |
| Pause, resume | <kbd>Space</kbd> or <kbd>P</kbd> | Pause button                  |
| Restart       | <kbd>R</kbd>                     | Play again button             |
| Mute          | <kbd>M</kbd>                     | Sound button                  |

Pressing a direction key on the menu starts a run straight away.

## How to run

Any static file server works, and so does the file itself:

```bash
# simplest: just open it
open index.html          # macOS
start index.html         # Windows

# or serve it locally
python3 -m http.server 8000
npx serve .
```

Then visit <http://localhost:8000> if you used a server.

## How to run the tests

The suite uses the Node built-in test runner — no dev dependencies to install.
Requires Node 18 or newer.

```bash
node --test
# or
npm test
```

It covers movement, growth, wall collisions, wrap-around, self-collision, the
tail-vacating edge case, reversal prevention, the input queue cap, food
placement never overlapping the snake, the board-full win, score and level
progression, speed capping, bonus spawn and expiry, state transitions, and a
few hostile inputs (a broken `rng`, nonsense board sizes).

## Project structure

```
snake-game/
├── index.html          markup, menu and overlay panels
├── css/
│   └── style.css       dark theme, responsive layout, focus states
├── js/
│   ├── main.js         bootstrap, fixed-timestep loop, UI wiring
│   ├── game.js         pure rules: no DOM, no canvas, no timers
│   ├── renderer.js     all canvas drawing, DPR handling, particles
│   ├── input.js        keyboard, swipe and D-pad handling
│   ├── audio.js        small WebAudio effects, lazily unlocked
│   └── storage.js      high score and settings, guarded localStorage
├── tests/
│   └── game.test.js    unit tests for the rules
├── package.json        marks the sources as ES modules; `npm test`
├── README.md
└── LICENSE
```

`game.js` knows nothing about the browser. It takes a board size, a difficulty
and an injected random number generator, exposes `tick()` and returns a list of
events (`eat`, `level`, `bonus-spawn`, `death`, `win`) that the caller turns
into sound and particles. That boundary is why the tests need no DOM shim.

## Roadmap

- Local two-player mode on a shared board
- Optional obstacle layouts and a maze mode
- Replays, stored as a seed plus the input queue
- A compact scoreboard of the last ten runs
- Gamepad support via the Gamepad API

## License

MIT — see [LICENSE](LICENSE).
