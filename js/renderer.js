/**
 * Canvas rendering. This is the only module that touches a drawing context.
 *
 * It reads a game snapshot and never writes to it. Sizing accounts for
 * devicePixelRatio so the board stays sharp on high density displays.
 */

const PALETTE = Object.freeze({
  background: '#0a0f1a',
  boardTop: '#111a2b',
  boardBottom: '#0b1220',
  grid: 'rgba(148, 163, 184, 0.07)',
  wall: 'rgba(56, 189, 248, 0.35)',
  wrap: 'rgba(148, 163, 184, 0.28)',
  snakeHead: '#6ee7a8',
  snakeBody: '#22c55e',
  snakeTail: '#0f766e',
  snakeOutline: 'rgba(5, 15, 10, 0.55)',
  eye: '#f8fafc',
  pupil: '#071015',
  food: '#f87171',
  foodCore: '#fecaca',
  bonus: '#fbbf24',
  bonusCore: '#fef3c7',
});

const TAU = Math.PI * 2;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = null;

    try {
      this.ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    } catch {
      this.ctx = null;
    }

    this.reducedMotion = Boolean(reducedMotion);
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.cell = 0;
    this.originX = 0;
    this.originY = 0;
    this.elapsed = 0;
    this.flash = 0;
    this.particles = [];
  }

  get isReady() {
    return Boolean(this.ctx);
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
    if (this.reducedMotion) {
      this.particles.length = 0;
      this.flash = 0;
    }
  }

  /** Matches the backing store to the element's CSS box. Safe to call on every resize. */
  resize() {
    if (!this.ctx) return false;

    let width = 0;
    let height = 0;
    try {
      const rect = this.canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    } catch {
      return false;
    }

    if (!width || !height) {
      width = this.canvas.clientWidth || 0;
      height = this.canvas.clientHeight || 0;
    }
    if (!width || !height) return false;

    const ratio = Number(globalThis.devicePixelRatio) || 1;
    const dpr = Math.min(3, Math.max(1, ratio));
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));

    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;

    this.dpr = dpr;
    this.cssWidth = width;
    this.cssHeight = height;
    return true;
  }

  /** Converts a cell coordinate to the pixel centre of that cell. */
  centreOf(x, y) {
    return {
      x: this.originX + (x + 0.5) * this.cell,
      y: this.originY + (y + 0.5) * this.cell,
    };
  }

  addBurst(x, y, color, count = 10) {
    if (this.reducedMotion || !this.cell) return;

    const { x: px, y: py } = this.centreOf(x, y);
    const total = Math.max(1, Math.min(24, count));
    for (let i = 0; i < total; i += 1) {
      const angle = (i / total) * TAU + Math.random() * 0.5;
      const speed = this.cell * (1.2 + Math.random() * 1.8);
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + Math.random() * 0.25,
        maxLife: 0.7,
        size: this.cell * (0.08 + Math.random() * 0.1),
        color,
      });
    }

    // Keep the pool bounded so a long session cannot grow without limit.
    if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
    this.flash = Math.min(1, this.flash + 0.55);
  }

  updateEffects(dt) {
    const seconds = Math.min(0.1, Math.max(0, dt) / 1000);
    this.elapsed += seconds;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - seconds * 3.2);
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= seconds;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.vy += this.cell * 4 * seconds;
      p.vx *= 0.96;
    }
  }

  /**
   * Draws one frame. `progress` is how far the current tick has advanced
   * (0..1) and is used to interpolate movement between grid cells.
   */
  draw(snapshot, { progress = 0, dt = 16 } = {}) {
    const ctx = this.ctx;
    if (!ctx || !snapshot) return;

    const cols = Math.max(1, snapshot.cols);
    const rows = Math.max(1, snapshot.rows);

    if (!this.cssWidth || !this.cssHeight) {
      if (!this.resize()) return;
    }

    this.cell = Math.min(this.cssWidth / cols, this.cssHeight / rows);
    const boardWidth = this.cell * cols;
    const boardHeight = this.cell * rows;
    this.originX = (this.cssWidth - boardWidth) / 2;
    this.originY = (this.cssHeight - boardHeight) / 2;

    this.updateEffects(dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    this.drawBoard(ctx, boardWidth, boardHeight, snapshot);
    this.drawGrid(ctx, cols, rows);
    if (snapshot.food) this.drawFood(ctx, snapshot.food);
    if (snapshot.bonus) this.drawBonus(ctx, snapshot);
    this.drawSnake(ctx, snapshot, progress);
    this.drawParticles(ctx);
    this.drawFlash(ctx, boardWidth, boardHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawBoard(ctx, boardWidth, boardHeight, snapshot) {
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const gradient = ctx.createLinearGradient(
      this.originX,
      this.originY,
      this.originX + boardWidth,
      this.originY + boardHeight,
    );
    gradient.addColorStop(0, PALETTE.boardTop);
    gradient.addColorStop(1, PALETTE.boardBottom);

    ctx.fillStyle = gradient;
    ctx.fillRect(this.originX, this.originY, boardWidth, boardHeight);

    ctx.save();
    ctx.lineWidth = Math.max(1, this.cell * 0.09);
    ctx.strokeStyle = snapshot.walls ? PALETTE.wall : PALETTE.wrap;
    if (!snapshot.walls) ctx.setLineDash([this.cell * 0.5, this.cell * 0.4]);
    const inset = ctx.lineWidth / 2;
    ctx.strokeRect(
      this.originX + inset,
      this.originY + inset,
      Math.max(0, boardWidth - ctx.lineWidth),
      Math.max(0, boardHeight - ctx.lineWidth),
    );
    ctx.restore();
  }

  drawGrid(ctx, cols, rows) {
    if (this.cell < 6) return;

    ctx.save();
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < cols; x += 1) {
      const px = Math.round(this.originX + x * this.cell) + 0.5;
      ctx.moveTo(px, this.originY);
      ctx.lineTo(px, this.originY + rows * this.cell);
    }
    for (let y = 1; y < rows; y += 1) {
      const py = Math.round(this.originY + y * this.cell) + 0.5;
      ctx.moveTo(this.originX, py);
      ctx.lineTo(this.originX + cols * this.cell, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawFood(ctx, food) {
    const { x, y } = this.centreOf(food.x, food.y);
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * 5) * 0.08;
    const radius = this.cell * 0.3 * pulse;

    ctx.save();
    const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.4, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, PALETTE.foodCore);
    gradient.addColorStop(1, PALETTE.food);

    ctx.shadowColor = 'rgba(248, 113, 113, 0.55)';
    ctx.shadowBlur = this.cell * 0.7;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawBonus(ctx, snapshot) {
    const bonus = snapshot.bonus;
    const { x, y } = this.centreOf(bonus.x, bonus.y);
    const radius = this.cell * 0.34;
    const remaining = snapshot.bonusLifetime > 0 ? clamp01(snapshot.bonusTicksLeft / snapshot.bonusLifetime) : 0;

    ctx.save();
    ctx.translate(x, y);
    if (!this.reducedMotion) ctx.rotate(Math.sin(this.elapsed * 2.2) * 0.3);

    const gradient = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
    gradient.addColorStop(0, PALETTE.bonusCore);
    gradient.addColorStop(1, PALETTE.bonus);

    ctx.shadowColor = 'rgba(251, 191, 36, 0.6)';
    ctx.shadowBlur = this.cell * 0.8;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? radius : radius * 0.48;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Countdown ring: shrinks as the bonus nears expiry.
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
    ctx.lineWidth = Math.max(1, this.cell * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, this.cell * 0.46, -Math.PI / 2, -Math.PI / 2 + TAU * remaining);
    ctx.stroke();
    ctx.restore();
  }

  /** Interpolated pixel path from head to tail, split where the snake wraps. */
  snakePath(snapshot, progress) {
    const t = this.reducedMotion ? 1 : clamp01(progress);
    const animate = !this.reducedMotion && snapshot.state === 'playing';
    const points = [];

    for (let i = 0; i < snapshot.snake.length; i += 1) {
      const current = snapshot.snake[i];
      const previous = snapshot.prevSnake[i] || current;
      let x = current.x;
      let y = current.y;

      // Skip interpolation across a wrap, where the jump is more than one cell.
      const steppedOnce = Math.abs(current.x - previous.x) <= 1 && Math.abs(current.y - previous.y) <= 1;
      if (animate && steppedOnce) {
        x = lerp(previous.x, current.x, t);
        y = lerp(previous.y, current.y, t);
      }
      points.push(this.centreOf(x, y));
    }

    const limit = this.cell * 1.6;
    const paths = [];
    let run = [];
    for (let i = 0; i < points.length; i += 1) {
      if (i > 0) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        if (Math.hypot(dx, dy) > limit) {
          paths.push(run);
          run = [];
        }
      }
      run.push(points[i]);
    }
    if (run.length) paths.push(run);
    return { points, paths };
  }

  drawSnake(ctx, snapshot, progress) {
    if (!snapshot.snake.length) return;

    const { points, paths } = this.snakePath(snapshot, progress);
    const head = points[0];
    const tail = points[points.length - 1];
    const width = this.cell * 0.78;

    const gradient = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    gradient.addColorStop(0, PALETTE.snakeHead);
    gradient.addColorStop(0.45, PALETTE.snakeBody);
    gradient.addColorStop(1, PALETTE.snakeTail);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const stroke = (style, lineWidth) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      for (const path of paths) {
        ctx.beginPath();
        if (path.length === 1) {
          ctx.moveTo(path[0].x, path[0].y);
          ctx.lineTo(path[0].x + 0.01, path[0].y);
        } else {
          ctx.moveTo(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
    };

    stroke(PALETTE.snakeOutline, width + Math.max(2, this.cell * 0.14));
    if (snapshot.state === 'playing' && !this.reducedMotion) {
      ctx.shadowColor = 'rgba(34, 197, 94, 0.35)';
      ctx.shadowBlur = this.cell * 0.6;
    }
    stroke(gradient, width);
    ctx.shadowBlur = 0;

    // Head highlight keeps the leading cell readable against the body.
    ctx.fillStyle = PALETTE.snakeHead;
    ctx.beginPath();
    ctx.arc(head.x, head.y, width * 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    this.drawEyes(ctx, snapshot, points, width);
  }

  drawEyes(ctx, snapshot, points, width) {
    const head = points[0];
    const next = points[1];

    let fx = 0;
    let fy = 0;
    if (next) {
      fx = head.x - next.x;
      fy = head.y - next.y;
    }
    const length = Math.hypot(fx, fy);
    if (length > 0.0001) {
      fx /= length;
      fy /= length;
    } else {
      const fallback = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      const vector = fallback[snapshot.direction] || fallback.right;
      fx = vector[0];
      fy = vector[1];
    }

    const px = -fy;
    const py = fx;
    const forward = width * 0.18;
    const side = width * 0.26;
    const scleraRadius = Math.max(1, width * 0.17);
    const pupilRadius = Math.max(0.6, width * 0.085);
    const dead = snapshot.state === 'gameover';

    ctx.save();
    for (const sign of [-1, 1]) {
      const ex = head.x + fx * forward + px * side * sign;
      const ey = head.y + fy * forward + py * side * sign;

      ctx.fillStyle = PALETTE.eye;
      ctx.beginPath();
      ctx.arc(ex, ey, scleraRadius, 0, TAU);
      ctx.fill();

      if (dead) {
        // Crossed-out eyes on death read instantly at small sizes.
        ctx.strokeStyle = PALETTE.pupil;
        ctx.lineWidth = Math.max(1, width * 0.08);
        ctx.beginPath();
        ctx.moveTo(ex - scleraRadius * 0.7, ey - scleraRadius * 0.7);
        ctx.lineTo(ex + scleraRadius * 0.7, ey + scleraRadius * 0.7);
        ctx.moveTo(ex + scleraRadius * 0.7, ey - scleraRadius * 0.7);
        ctx.lineTo(ex - scleraRadius * 0.7, ey + scleraRadius * 0.7);
        ctx.stroke();
      } else {
        ctx.fillStyle = PALETTE.pupil;
        ctx.beginPath();
        ctx.arc(ex + fx * pupilRadius * 0.6, ey + fy * pupilRadius * 0.6, pupilRadius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    if (!this.particles.length) return;

    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = clamp01(p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFlash(ctx, boardWidth, boardHeight) {
    if (this.flash <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = Math.min(0.16, this.flash * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.originX, this.originY, boardWidth, boardHeight);
    ctx.restore();
  }

  clearEffects() {
    this.particles.length = 0;
    this.flash = 0;
  }
}

export { PALETTE };
