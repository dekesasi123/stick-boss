/* =========================================================================
   火柴人剑斗 · 三场 Boss 战
   -------------------------------------------------------------------------
   操作：A/D 移动　空格 跳跃　左键 攻击　右键 格挡（按下瞬间 = 弹反）　R 重开
   机制：只狼式「血 + 架势」——打空血量或打满架势都能赢；
        弹反（deflect）不受伤且大幅增加对方架势；格挡只减伤、自己涨架势。
   画面：火柴人 + 纯色块，无贴图、无动画资源。
   ========================================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------------- 基础
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const GROUND = H - 74;          // 地面 y
  const GRAVITY = 1750;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  // 虚拟时钟：快进（?ff=秒）时用它驱动，保证弹反窗口等时间逻辑也按模拟时间走
  let vclock = null;
  const now = () => (vclock !== null ? vclock : performance.now() / 1000);

  // 调试参数：?boss=1..3  &god=1  &auto=1
  const QS = new URLSearchParams(location.search);
  const DEBUG = {
    boss: QS.has('boss') ? clamp(parseInt(QS.get('boss'), 10) || 1, 1, 3) : 0,
    god: QS.get('god') === '1',
    auto: QS.get('auto') === '1',
    fps: QS.get('fps') === '1',
    ff: QS.has('ff') ? Math.max(0, Math.min(60, parseFloat(QS.get('ff')) || 0)) : 0,
    p2: QS.get('p2') === '1',   // 强制 Boss 进入二阶段（调试用）
    hud: QS.get('hud') === '1', // 显示坐标/状态数值
    vcheck: QS.get('vcheck') === '1', // 效果自检：一次性画出弹幕/落雷/冲击波
  };

  // ---------------------------------------------------------------- 输入
  const keys = Object.create(null);
  const input = {
    left: false, right: false,
    attackQueued: 0,          // 攻击缓冲（避免连点丢失）
    jumpQueued: 0,
    blockHeld: false,
    parryPressedAt: -99,      // 最近一次右键按下的时间
    mouseX: W / 2, mouseY: H / 2,
  };
  // 暴露给触屏层（index.html 里的虚拟按键）读写
  window.__gameInput = input;

  function setKey(code, down) {
    keys[code] = down;
    if (code === 'KeyA' || code === 'ArrowLeft') input.left = down;
    if (code === 'KeyD' || code === 'ArrowRight') input.right = down;
    if (down && code === 'Space') input.jumpQueued = 0.14;
    if (down && (code === 'KeyJ')) input.attackQueued = 0.14;
  }

  addEventListener('keydown', (e) => {
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    setKey(e.code, true);
    if (e.code === 'KeyR') game.restart();
    if (e.code === 'Escape') game.togglePause();
    if ((e.code === 'Space' || e.code === 'Enter') && game.state !== 'playing') game.confirm();
  });
  addEventListener('keyup', (e) => setKey(e.code, false));

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) * (W / r.width);
    input.mouseY = (e.clientY - r.top) * (H / r.height);
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.attackQueued = 0.14; }
    if (e.button === 2) { input.blockHeld = true; input.parryPressedAt = now(); }
    e.preventDefault();
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 2) input.blockHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 触屏：点画布开始 / 重来（手机上没法按空格）
  canvas.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('touch') && game.state !== 'playing') {
      e.preventDefault();
      game.confirm();
    }
  });
  addEventListener('blur', () => {
    input.left = input.right = false;
    input.blockHeld = false;
    for (const k in keys) keys[k] = false;
  });

  // ---------------------------------------------------------------- 特效
  const fx = [];
  function spark(x, y, n = 8, color = '#ffd166', spread = 260) {
    for (let i = 0; i < n; i++) {
      const a = rand(-0.9, 0.9) - Math.PI / 2;
      const sp = rand(spread * 0.35, spread);
      fx.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.16, 0.34), max: 0.34, color, w: rand(1.5, 3),
      });
    }
  }
  function slashFx(x, y, dir, color = 'rgba(30,32,36,.85)') {
    fx.push({ x, y, vx: 0, vy: 0, life: 0.16, max: 0.16, color, arc: { dir, r: 52 } });
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.life -= dt;
      if (p.life <= 0) { fx.splice(i, 1); continue; }
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      if (p.vy !== undefined) p.vy += 900 * dt;
    }
  }
  function drawFx() {
    for (const p of fx) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      if (p.arc) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const cx = p.x, cy = p.y, r = p.arc.r;
        const start = p.arc.dir > 0 ? -0.7 : Math.PI - 0.7;
        const end = p.arc.dir > 0 ? 0.7 : Math.PI + 0.7;
        ctx.arc(cx, cy, r, start, end);
        ctx.stroke();
      } else {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- 玩家
  class Player {
    constructor() {
      this.x = 240;
      this.y = GROUND;
      this.vx = 0; this.vy = 0;
      this.w = 26; this.h = 96;
      this.face = 1;
      this.maxHp = 100; this.hp = 100;
      this.posture = 0; this.maxPosture = 100;
      this.postureDelay = 0;
      this.state = 'idle';        // idle|run|air|attack|block|stagger|dead
      this.stateT = 0;
      this.attackStage = 0;       // 连段 0..2
      this.comboTimer = 0;
      this.hitDone = false;
      this.iframe = 0;
      this.blocking = false;
      this.deflectWindow = 0;
      this.attackCd = 0;
      this.trail = [];
      this.flash = 0;
    }

    get alive() { return this.state !== 'dead'; }
    get invulnerable() { return this.iframe > 0 || DEBUG.god; }

    reset() {
      this.x = 240; this.y = GROUND; this.vx = 0; this.vy = 0;
      this.hp = this.maxHp; this.posture = 0; this.state = 'idle';
      this.stateT = 0; this.attackStage = 0; this.iframe = 0;
      this.blocking = false; this.deflectWindow = 0; this.flash = 0; this.trail = [];
    }

    startAttack() {
      const stage = this.comboTimer > 0 ? (this.attackStage + 1) % 3 : 0;
      this.attackStage = stage;
      this.state = 'attack';
      this.stateT = 0;
      this.hitDone = false;
      this.comboTimer = 0;
      this.attackCd = 0.06;
    }

    hurt(dmg, fromX, opts = {}) {
      if (this.invulnerable || !this.alive) return 'none';
      const dir = Math.sign(this.x - fromX) || 1;

      // 弹反窗口
      if (opts.parryable && this.deflectWindow > 0) {
        this.deflectWindow = 0;
        this.posture = clamp(this.posture + 2, 0, this.maxPosture);
        spark(this.x + 30 * dir, this.y - 54, 10, '#ffe066', 320);
        game.shake(0.12, 5);
        game.onDeflect();
        return 'deflect';
      }

      // 格挡
      if (this.blocking && opts.blockable !== false) {
        const chip = dmg * 0.18;
        this.hp = clamp(this.hp - chip, 0, this.maxHp);
        this.posture = clamp(this.posture + dmg * 0.85, 0, this.maxPosture);
        this.postureDelay = 0.9;
        this.vx = dir * 90;
        spark(this.x + 24 * dir, this.y - 56, 5, '#c9ccd3', 200);
        game.shake(0.08, 3);
        if (this.posture >= this.maxPosture) this.stagger();
        if (this.hp <= 0) this.die();
        return 'block';
      }

      // 命中
      this.hp = clamp(this.hp - dmg, 0, this.maxHp);
      this.posture = clamp(this.posture + dmg * 1.35, 0, this.maxPosture);
      this.postureDelay = 1.1;
      this.iframe = 0.36;
      this.flash = 0.18;
      this.vx = dir * 210;
      this.vy = -140;
      this.state = 'air';
      this.stateT = 0;
      this.attackStage = 0;
      this.comboTimer = 0;
      spark(this.x, this.y - 56, 9, '#e03131', 260);
      game.shake(0.16, 7);
      if (this.posture >= this.maxPosture) this.stagger();
      if (this.hp <= 0) this.die();
      return 'hit';
    }

    stagger() {
      this.posture = this.maxPosture;
      this.state = 'stagger';
      this.stateT = 0;
      this.blocking = false;
      game.shake(0.2, 6);
    }

    die() {
      this.state = 'dead';
      this.stateT = 0;
      this.hp = 0;
      game.onPlayerDeath();
    }

    update(dt) {
      this.stateT += dt;
      this.iframe = Math.max(0, this.iframe - dt);
      this.flash = Math.max(0, this.flash - dt);
      this.attackCd = Math.max(0, this.attackCd - dt);
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      this.postureDelay = Math.max(0, this.postureDelay - dt);
      this.deflectWindow = Math.max(0, this.deflectWindow - dt);

      // 右键按下瞬间开启 0.13s 弹反窗口
      if (input.blockHeld && now() - input.parryPressedAt < 0.13) {
        this.deflectWindow = 0.13 - (now() - input.parryPressedAt);
      }

      const onGround = this.y >= GROUND - 0.5;

      // 架势自然回落
      if (this.postureDelay <= 0 && this.state !== 'stagger') {
        this.posture = clamp(this.posture - 26 * dt, 0, this.maxPosture);
      }

      if (this.state === 'dead') {
        this.vx *= 0.9;
        this.x += this.vx * dt;
        return;
      }

      if (this.state === 'stagger') {
        this.blocking = false;
        this.vx *= 0.85;
        this.x += this.vx * dt;
        if (this.stateT > 1.0) { this.state = 'idle'; this.stateT = 0; this.posture = 40; }
        return;
      }

      // 攻击中：位移锁定，按帧判定
      if (this.state === 'attack') {
        const stage = this.attackStage;
        const windup = [0.12, 0.11, 0.16][stage];
        const active = [0.09, 0.09, 0.12][stage];
        const recover = [0.20, 0.20, 0.30][stage];
        this.blocking = false;
        this.vx *= 0.82;
        this.x += this.vx * dt;

        if (this.stateT >= windup && this.stateT < windup + active && !this.hitDone) {
          const boss = game.boss;
          if (boss && boss.alive) {
            const reach = 112;
            const inFront = (boss.x - this.x) * this.face > -20;
            const dist = Math.abs(boss.x - this.x);
            if (inFront && dist < reach && Math.abs(boss.y - this.y) < 120) {
              this.hitDone = true;
              boss.takeHit([22, 22, 32][stage], this.x);
            }
          }
        }
        if (this.stateT > windup + active + recover) {
          this.comboTimer = 0.34;
          this.state = onGround ? 'idle' : 'air';
          this.stateT = 0;
        }
        return;
      }

      // 格挡：不能移动，消耗少量体力（这里不设体力，只减速）
      this.blocking = input.blockHeld && onGround && this.attackCd <= 0;
      if (this.blocking) {
        this.vx *= 0.8;
        this.x += this.vx * dt;
        if (this.posture >= this.maxPosture) this.stagger();
        return;
      }

      // 左右移动
      let ax = 0;
      if (input.left) ax -= 1;
      if (input.right) ax += 1;
      const speed = onGround ? 265 : 210;
      if (ax !== 0) {
        this.vx = clamp(this.vx + ax * 2200 * dt, -speed, speed);
        this.face = ax > 0 ? 1 : -1;
      } else {
        this.vx *= onGround ? 0.72 : 0.94;
      }
      this.x += this.vx * dt;
      this.x = clamp(this.x, 40, W - 40);

      // 跳跃
      if (input.jumpQueued > 0 && onGround) {
        this.vy = -620;
        this.y = GROUND - 1;
        input.jumpQueued = 0;
        this.state = 'air';
      }
      // 攻击
      if (input.attackQueued > 0 && onGround && this.attackCd <= 0) {
        input.attackQueued = 0;
        this.startAttack();
        return;
      }
      input.attackQueued = Math.max(0, input.attackQueued - dt);
      input.jumpQueued = Math.max(0, input.jumpQueued - dt);

      // 重力
      if (!onGround || this.vy < 0) {
        this.vy += GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.y >= GROUND) {
          this.y = GROUND;
          this.vy = 0;
          if (this.state === 'air') { this.state = 'idle'; this.stateT = 0; }
        } else {
          this.state = 'air';
        }
      }
      if (onGround && this.state !== 'air' && Math.abs(this.vx) > 20) this.state = 'run';
      else if (onGround && this.state === 'run' && Math.abs(this.vx) <= 20) this.state = 'idle';
    }

    draw() {
      const x = this.x, y = this.y;
      const f = this.face;
      const hurt = this.flash > 0;
      const body = hurt ? '#e03131' : '#22262b';

      ctx.save();
      // 影子
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, GROUND + 4, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = body;
      ctx.fillStyle = body;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';

      const hipY = y - 52;
      const headY = y - 86;

      // 躯干
      ctx.beginPath();
      ctx.moveTo(x, hipY);
      ctx.lineTo(x, y - 62);
      ctx.stroke();

      // 头
      ctx.beginPath();
      ctx.arc(x, headY, 11, 0, Math.PI * 2);
      ctx.stroke();

      // 腿
      let legPhase = 0;
      if (this.state === 'run') legPhase = Math.sin(this.stateT * 16) * 10;
      const air = this.state === 'air' || this.state === 'dead';
      ctx.beginPath();
      ctx.moveTo(x, hipY);
      ctx.lineTo(x - 9 + (air ? -6 : legPhase), y - 4);
      ctx.moveTo(x, hipY);
      ctx.lineTo(x + 9 + (air ? 8 : -legPhase), y - 4);
      ctx.stroke();

      // 手臂
      const drawArm = (ang, len, sx, sy) => {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
        ctx.stroke();
      };
      const shoulderY = y - 62;

      if (this.state === 'attack') {
        const stage = this.attackStage;
        const windup = [0.12, 0.11, 0.16][stage];
        const total = windup + [0.09, 0.09, 0.12][stage] + [0.20, 0.20, 0.30][stage];
        const p = clamp(this.stateT / total, 0, 1);
        const swing = Math.sin(clamp((p - 0.18) / 0.42, 0, 1) * Math.PI);
        const ang = (-0.55 + swing * 1.5) * f;
        drawArm(ang, 34, x + 6 * f, shoulderY);
        // 剑气
        if (swing > 0.35 && swing < 0.95) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = '#3b4148';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x + 18 * f, shoulderY, 46, -0.9 * f + (f > 0 ? 0 : Math.PI), 0.7 * f + (f > 0 ? 0 : Math.PI));
          ctx.stroke();
          ctx.restore();
        }
      } else if (this.blocking) {
        drawArm(-0.35 * f, 30, x + 4 * f, shoulderY);
        drawArm(0.25 * f, 28, x + 4 * f, shoulderY + 6);
      } else {
        const t = this.stateT;
        const sway = this.state === 'run' ? Math.sin(t * 16) * 0.45 : Math.sin(t * 2) * 0.06;
        drawArm((0.9 + sway) * f, 30, x + 2 * f, shoulderY);
        drawArm((-0.9 - sway) * f, 30, x - 2 * f, shoulderY);
      }

      // 格挡盾线
      if (this.blocking) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#4c6ef5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + 16 * f, shoulderY + 4, 30, -1.1, 1.1, false);
        ctx.stroke();
        ctx.restore();
      }

      // 弹反窗口提示
      if (this.deflectWindow > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.4 * (this.deflectWindow / 0.13);
        ctx.strokeStyle = '#fab005';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + 16 * f, shoulderY + 4, 34, -1.2, 1.2, false);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 弹幕
  class Bullet {
    constructor(x, y, vx, vy, r, dmg, kind = 'bullet') {
      this.x = x; this.y = y; this.vx = vx; this.vy = vy;
      this.r = r; this.dmg = dmg; this.kind = kind;
      this.dead = false; this.life = 6;
      this.spin = rand(0, Math.PI * 2);
    }
    update(dt) {
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.spin += dt * 6;
      if (this.life <= 0 || this.x < -40 || this.x > W + 40 || this.y > H + 40) this.dead = true;
    }
    draw() {
      ctx.save();
      if (this.kind === 'lightning') {
        ctx.strokeStyle = '#7048e8';
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(this.x, 0);
        for (let y = 0; y < this.y; y += 24) {
          ctx.lineTo(this.x + Math.sin((y + this.spin * 40) * 0.05) * 10, y);
        }
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = this.kind === 'arrow' ? '#e8590c' : '#862e9c';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  class Shockwave {
    constructor(x, dir, speed = 420) {
      this.x = x; this.y = GROUND; this.dir = dir;
      this.speed = speed; this.dead = false; this.life = 2.2;
      this.h = 34;
    }
    update(dt) {
      this.life -= dt;
      this.x += this.dir * this.speed * dt;
      if (this.life <= 0 || this.x < -30 || this.x > W + 30) this.dead = true;
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#f08c00';
      ctx.beginPath();
      ctx.moveTo(this.x, GROUND);
      ctx.lineTo(this.x - this.dir * 26, GROUND - this.h);
      ctx.lineTo(this.x - this.dir * 8, GROUND - this.h * 0.5);
      ctx.lineTo(this.x - this.dir * 30, GROUND);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- Boss
  const BOSS_DEFS = [
    {
      name: '石守', title: '第一场 · 教学',
      hp: 260, posture: 100, speed: 62, scale: 1.05, color: '#3b3f45',
      intro: '先学会弹反',
      moves: [
        { id: 'slash', min: 0, max: 160, w: 6, windup: 0.58, active: 0.12, recover: 0.46, dmg: 9, reach: 118, cd: 0.75 },
        { id: 'sweep', min: 0, max: 170, w: 4, windup: 0.72, active: 0.16, recover: 0.55, dmg: 11, reach: 150, cd: 1.0, low: true },
      ],
    },
    {
      name: '弓取', title: '第二场 · 远与近',
      hp: 380, posture: 100, speed: 58, scale: 1.08, color: '#2f3437',
      intro: '别站在箭线上',
      moves: [
        { id: 'slash', min: 0, max: 150, w: 5, windup: 0.46, active: 0.11, recover: 0.38, dmg: 11, reach: 120, cd: 0.6 },
        { id: 'volley', min: 140, max: 999, w: 6, windup: 0.62, active: 0.1, recover: 0.45, dmg: 0, cd: 1.1, fire: 'volley' },
        { id: 'leap', min: 120, max: 999, w: 4, windup: 0.5, active: 0.12, recover: 0.5, dmg: 14, reach: 130, cd: 1.4, leap: true },
        { id: 'sweep', min: 0, max: 140, w: 3, windup: 0.6, active: 0.14, recover: 0.44, dmg: 12, reach: 140, cd: 0.9, low: true },
      ],
    },
    {
      name: '剑圣', title: '第三场 · 弦一郎',
      hp: 620, posture: 120, speed: 74, scale: 1.14, color: '#1f2429',
      intro: '他什么时候出手，你得看出来',
      moves: [
        { id: 'combo4', min: 0, max: 180, w: 6, windup: 0.34, active: 0.09, recover: 0.22, dmg: 9, reach: 112, cd: 0.55, combo: 4, comboWindup: 0.15 },
        { id: 'thrust', min: 90, max: 240, w: 4, windup: 0.5, active: 0.12, recover: 0.5, dmg: 17, reach: 175, cd: 1.0 },
        { id: 'jumpSlash', min: 120, max: 999, w: 4, windup: 0.46, active: 0.12, recover: 0.42, dmg: 13, reach: 120, cd: 1.2, leap: true },
        { id: 'fan5', min: 150, max: 999, w: 4, windup: 0.5, active: 0.1, recover: 0.5, dmg: 0, cd: 1.3, fire: 'fan5', phase2: true },
        { id: 'lightning', min: 0, max: 999, w: 3, windup: 0.35, active: 0.1, recover: 0.6, dmg: 0, cd: 2.2, fire: 'lightning', phase2: true },
        { id: 'sweep', min: 0, max: 150, w: 3, windup: 0.42, active: 0.12, recover: 0.36, dmg: 12, reach: 150, cd: 0.7, low: true },
      ],
    },
  ];

  class Boss {
    constructor(def) {
      this.def = def;
      this.maxHp = def.hp; this.hp = def.hp;
      this.maxPosture = def.posture || 100; this.posture = 0;
      this.x = W - 240; this.y = GROUND;
      this.vx = 0; this.vy = 0;
      this.face = -1;
      this.state = 'idle';         // idle|windup|active|recover|stagger|dead
      this.stateT = 0;
      this.move = null;
      this.cd = 0.9;
      this.postureDelay = 0;
      this.hitDone = false;
      this.comboLeft = 0;
      this.flash = 0;
      this.phase2 = false;
      this.intro = 1.1;
      this.swing = 0;
    }

    get alive() { return this.state !== 'dead'; }
    get staggerT() { return this.state === 'stagger' ? this.stateT : 0; }

    takeHit(dmg, fromX) {
      if (!this.alive) return;
      const mult = this.state === 'stagger' ? 1.7 : 1;
      this.hp = clamp(this.hp - dmg * mult, 0, this.maxHp);
      this.posture = clamp(this.posture + dmg * 0.42 + 3, 0, this.maxPosture);
      this.postureDelay = 0.8;
      this.flash = 0.12;
      spark((this.x + fromX) / 2, this.y - 58, 6, '#e03131', 220);
      game.shake(0.07, 3);
      if (this.posture >= this.maxPosture) this.stagger();
      if (this.hp <= 0) {
        this.state = 'dead'; this.stateT = 0;
        spark(this.x, this.y - 60, 22, '#212529', 380);
        game.onBossDead();
      }
    }

    onDeflect() {
      this.posture = clamp(this.posture + 17, 0, this.maxPosture);
      this.postureDelay = 0.9;
      if (this.posture >= this.maxPosture) this.stagger();
      // 弹反打断当前招式
      if (this.state === 'windup' || this.state === 'active') {
        this.state = 'recover';
        this.stateT = 0;
        this.move = null;
        this.cd = Math.max(this.cd, 0.35);
      }
    }

    stagger() {
      this.posture = this.maxPosture;
      this.state = 'stagger';
      this.stateT = 0;
      this.move = null;
      game.shake(0.22, 7);
      spark(this.x, this.y - 60, 14, '#fab005', 300);
    }

    chooseMove() {
      const dist = Math.abs(game.player.x - this.x);
      const pool = this.def.moves.filter((m) => {
        if (m.phase2 && !this.phase2) return false;
        if (dist < m.min || dist > m.max) return false;
        return true;
      });
      if (!pool.length) return null;
      let total = 0;
      for (const m of pool) total += m.w;
      let r = Math.random() * total;
      for (const m of pool) {
        r -= m.w;
        if (r <= 0) return m;
      }
      return pool[pool.length - 1];
    }

    startMove(m) {
      this.move = m;
      this.state = 'windup';
      this.stateT = 0;
      this.hitDone = false;
      this.comboFast = null;
      this.comboLeft = m.combo ? m.combo - 1 : 0;
      this.face = Math.sign(game.player.x - this.x) || this.face;
    }

    fire(kind) {
      const p = game.player;
      const bx = this.x + 34 * this.face;
      const by = this.y - 62;
      if (kind === 'volley') {
        const base = Math.atan2((p.y - 60) - by, p.x - bx);
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.16;
          game.bullets.push(new Bullet(bx, by, Math.cos(a) * 430, Math.sin(a) * 430, 6, 9, 'arrow'));
        }
      } else if (kind === 'fan5') {
        const base = Math.atan2((p.y - 60) - by, p.x - bx);
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.22;
          game.bullets.push(new Bullet(bx, by, Math.cos(a) * 330, Math.sin(a) * 330, 7, 8, 'orb'));
        }
      } else if (kind === 'lightning') {
        game.lightning.push({ x: p.x, t: 0.95, struck: false, dmg: 22 });
      }
      spark(bx, by, 5, '#862e9c', 160);
    }

    update(dt) {
      this.stateT += dt;
      this.postureDelay = Math.max(0, this.postureDelay - dt);
      this.flash = Math.max(0, this.flash - dt);

      if (this.intro > 0) { this.intro -= dt; return; }
      if (this.state === 'dead') { this.vx *= 0.9; this.x += this.vx * dt; return; }

      if (!this.phase2 && this.hp <= this.maxHp * 0.5) { this.phase2 = true; }
      if (this.postureDelay <= 0 && this.state !== 'stagger') {
        this.posture = clamp(this.posture - 15 * dt, 0, this.maxPosture);
      }

      const p = game.player;
      const dist = Math.abs(p.x - this.x);

      if (this.state === 'stagger') {
        this.vx *= 0.85;
        this.x += this.vx * dt;
        if (this.stateT > 1.7) { this.state = 'idle'; this.stateT = 0; this.cd = 0.3; this.posture = this.maxPosture * 0.4; }
        return;
      }

      if (this.state === 'idle') {
        // 朝玩家缓慢靠近
        const dir = Math.sign(p.x - this.x) || 1;
        this.face = dir;
        if (dist > 110) this.vx = dir * this.def.speed;
        else this.vx *= 0.8;
        this.x += this.vx * dt;
        this.x = clamp(this.x, 60, W - 60);

        this.cd -= dt;
        if (this.cd <= 0) {
          const m = this.chooseMove();
          if (m) this.startMove(m);
          else this.cd = 0.25;
        }
        return;
      }

      if (this.state === 'windup') {
        this.vx *= 0.85;
        this.x += this.vx * dt;
        const m = this.move;
        const wu = this.comboFast != null ? this.comboFast : m.windup;
        if (this.stateT >= wu) {
          this.state = 'active';
          this.stateT = 0;
          this.hitDone = false;
          // 招式的即时效果
          if (m.fire) this.fire(m.fire);
          if (m.leap) {
            this.vy = -560;
            this.vx = Math.sign(p.x - this.x) * 260;
            this.leaping = true;
          }
          if (m.dash) {
            this.vx = Math.sign(p.x - this.x) * 520;
          }
        }
        return;
      }

      if (this.state === 'active') {
        const m = this.move;
        // 跳跃落地
        if (this.leaping) {
          this.vy += GRAVITY * dt;
          this.y += this.vy * dt;
          this.x += this.vx * dt;
          this.x = clamp(this.x, 60, W - 60);
          if (this.y >= GROUND) {
            this.y = GROUND;
            this.leaping = false;
            game.shake(0.18, 6);
            game.waves.push(new Shockwave(this.x, 1), new Shockwave(this.x, -1));
            spark(this.x, GROUND - 6, 12, '#f08c00', 260);
          }
        } else {
          this.x += this.vx * dt;
          this.x = clamp(this.x, 60, W - 60);
        }

        // 近战判定
        if (m.reach > 0 && !this.hitDone && this.stateT < m.active) {
          const inFront = (p.x - this.x) * this.face > -10;
          if (inFront && dist < m.reach && p.y > GROUND - 130) {
            this.hitDone = true;
            const res = p.hurt(m.dmg, this.x, { parryable: true, blockable: true, low: m.low });
            if (res === 'deflect') this.onDeflect();
            if (res !== 'none') {
              spark((p.x + this.x) / 2, p.y - 58, 8, res === 'deflect' ? '#ffe066' : '#e03131', 260);
            }
          }
        }

        if (this.stateT >= m.active) {
          if (this.comboLeft > 0) {
            // 连段：后续段用更短起手，节奏才像弦一郎
            this.comboLeft -= 1;
            this.state = 'windup';
            this.stateT = 0;
            this.hitDone = false;
            this.comboFast = m.comboWindup || 0.16;
            this.cd = 0.12;
            return;
          }
          this.state = 'recover';
          this.stateT = 0;
        }
        return;
      }

      if (this.state === 'recover') {
        this.vx *= 0.82;
        this.x += this.vx * dt;
        const m = this.move;
        const rec = m ? m.recover : 0.4;
        if (this.stateT >= rec) {
          this.state = 'idle';
          this.stateT = 0;
          this.move = null;
          this.cd = Math.max(0.12, (m && m.cd ? m.cd : 0.6) * (this.phase2 ? 0.72 : 1));
        }
      }
    }

    draw() {
      const x = this.x, y = this.y;
      const f = this.face;
      const s = this.def.scale;
      const hurt = this.flash > 0;
      const tel = this.state === 'windup';
      const col = this.state === 'dead'
        ? 'rgba(120,120,120,.35)'
        : hurt ? '#e03131' : tel ? '#e8590c' : this.def.color;

      ctx.save();
      // 影子
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, GROUND + 4, 26 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 5 * s;
      ctx.lineCap = 'round';

      const hipY = y - 62 * s;
      const headY = y - 100 * s;
      const shoulderY = y - 76 * s;

      ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x, y - 74 * s); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, headY, 13 * s, 0, Math.PI * 2); ctx.stroke();

      // 腿
      const legSpread = this.state === 'idle' ? 0 : 6;
      ctx.beginPath();
      ctx.moveTo(x, hipY); ctx.lineTo(x - (10 + legSpread) * s, y - 4);
      ctx.moveTo(x, hipY); ctx.lineTo(x + (10 + legSpread) * s, y - 4);
      ctx.stroke();

      // 手臂 + 武器
      const drawArm = (ang, len) => {
        const ex = x + Math.cos(ang) * len;
        const ey = shoulderY + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        return [ex, ey];
      };

      let armAng = 0.2 * f;
      let swingP = 0;
      if (this.state === 'windup') {
        swingP = -0.55;
        armAng = (-1.35 + swingP * 0.2) * f;
      } else if (this.state === 'active') {
        armAng = 0.85 * f;
      } else if (this.state === 'recover') {
        armAng = 0.5 * f;
      } else if (this.state === 'stagger') {
        armAng = -0.2 * f;
      }
      if (this.move && (this.move.id === 'volley' || this.move.id === 'fan5') && this.state === 'windup') {
        armAng = -0.15 * f;
      }

      const [hx, hy] = drawArm(armAng, 34 * s);
      // 剑
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(armAng - 0.25 * f) * 58 * s, hy + Math.sin(armAng - 0.25 * f) * 58 * s);
      ctx.stroke();

      // 另一只手
      ctx.lineWidth = 5 * s;
      drawArm((this.state === 'windup' ? -0.9 : 0.9) * f, 30 * s);

      // 起手预警：头顶一条红色提示
      if (this.state === 'windup' && this.move) {
        const wu = this.comboFast != null ? this.comboFast : this.move.windup;
        const prog = clamp(this.stateT / wu, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#e8590c';
        ctx.fillRect(x - 26, headY - 34, 52 * prog, 4);
        ctx.strokeStyle = 'rgba(232,89,12,.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 26, headY - 34, 52, 4);
        ctx.restore();
      }

      // 架势条（Boss 头顶）
      if (this.alive) {
        const bw = 92;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(x - bw / 2, headY - 20, bw, 5);
        ctx.fillStyle = this.posture > this.maxPosture * 0.75 ? '#e03131' : '#f59f00';
        ctx.fillRect(x - bw / 2, headY - 20, bw * (this.posture / this.maxPosture), 5);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 游戏
  const game = {
    state: 'menu',              // menu|playing|dead|win|paused|cleared
    player: new Player(),
    boss: null,
    bossIndex: 0,
    bullets: [],
    waves: [],
    lightning: [],
    shakeT: 0,
    shakeMag: 0,
    hitStop: 0,
    time: 0,
    message: '',
    messageT: 0,

    shake(t, m) {
      this.shakeT = Math.max(this.shakeT, t);
      this.shakeMag = Math.max(this.shakeMag, m);
    },

    onDeflect() { this.hitStop = Math.max(this.hitStop, 0.05); },
    onBossDead() {
      this.hitStop = 0.16;
      this.message = '击破';
      this.messageT = 1.4;
      setTimeout(() => {
        if (this.state !== 'playing') return;
        if (this.bossIndex >= BOSS_DEFS.length - 1) {
          this.state = 'cleared';
        } else {
          this.bossIndex += 1;
          this.spawnBoss();
          this.state = 'playing';
        }
      }, 1500);
    },
    onPlayerDeath() {
      this.state = 'dead';
      this.message = '你死了';
      this.messageT = 1.2;
    },

    spawnBoss() {
      this.boss = new Boss(BOSS_DEFS[this.bossIndex]);
      if (DEBUG.p2) {
        this.boss.hp = this.boss.maxHp * 0.45;
        this.boss.phase2 = true;
      }
      this.player.reset();
      this.player.x = 240;
      this.bullets = [];
      this.waves = [];
      this.lightning = [];
      this.message = BOSS_DEFS[this.bossIndex].title + '　' + BOSS_DEFS[this.bossIndex].name;
      this.messageT = 1.6;
    },

    start() {
      this.bossIndex = DEBUG.boss ? DEBUG.boss - 1 : 0;
      this.spawnBoss();
      this.state = 'playing';
    },

    restart() {
      if (this.state === 'menu') return;
      this.spawnBoss();
      this.state = 'playing';
    },

    confirm() {
      if (this.state === 'menu' || this.state === 'cleared') {
        this.bossIndex = 0;
        this.start();
      } else if (this.state === 'dead') {
        this.restart();
      } else if (this.state === 'paused') {
        this.state = 'playing';
      }
    },

    togglePause() {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    },
  };

  // ---------------------------------------------------------------- 逻辑更新
  function updateBullets(dt) {
    const p = game.player;
    for (const b of game.bullets) {
      b.update(dt);
      if (b.dead) continue;
      if (!p.alive) continue;
      const dx = b.x - p.x;
      const dy = b.y - (p.y - 52);
      if (Math.hypot(dx, dy) < b.r + 20) {
        const res = p.hurt(b.dmg, b.x, { parryable: false, blockable: true });
        if (res !== 'none') b.dead = true;
      }
    }
    game.bullets = game.bullets.filter((b) => !b.dead);

    for (const w of game.waves) {
      w.update(dt);
      if (!p.alive) continue;
      if (Math.abs(w.x - p.x) < 30 && p.y > GROUND - w.h) {
        const res = p.hurt(12, w.x, { parryable: false, blockable: true });
        if (res !== 'none') w.dead = true;
      }
    }
    game.waves = game.waves.filter((w) => !w.dead);

    for (const L of game.lightning) {
      L.t -= dt;
      if (!L.struck && L.t <= 0) {
        L.struck = true;
        spark(L.x, GROUND - 10, 18, '#7048e8', 340);
        if (p.alive && Math.abs(p.x - L.x) < 46) {
          p.hurt(L.dmg, L.x, { parryable: false, blockable: true });
        }
        game.shake(0.18, 6);
      }
    }
    game.lightning = game.lightning.filter((L) => L.t > -0.25);
  }

  function update(dt) {
    game.time += dt;

    if (game.state === 'playing') {
      if (game.hitStop > 0) { game.hitStop -= dt; return; }
      game.player.update(dt);
      if (game.boss) game.boss.update(dt);

      // 身体碰撞：不允许两个火柴人站在同一个格子里
      if (game.boss && game.boss.alive && game.player.alive) {
        const dx = game.player.x - game.boss.x;
        const minD = 46;
        if (Math.abs(dx) < minD) {
          const push = (minD - Math.abs(dx)) / 2;
          const s = Math.sign(dx) || 1;
          game.player.x = clamp(game.player.x + push * s, 40, W - 40);
          game.boss.x = clamp(game.boss.x - push * s, 60, W - 60);
        }
      }

      updateBullets(dt);
      updateFx(dt);
      if (game.messageT > 0) game.messageT -= dt;
      if (game.shakeT > 0) game.shakeT -= dt;
    } else if (game.state === 'dead' || game.state === 'cleared') {
      updateFx(dt);
      if (game.shakeT > 0) game.shakeT -= dt;
      if (game.boss) game.boss.update(dt * 0.35);
      updateBullets(dt * 0.35);
    }
  }

  // ---------------------------------------------------------------- 渲染
  function drawBackground() {
    // 极简：地面 + 远景竖线（无贴图）
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7f8fa');
    g.addColorStop(1, '#e9ebef');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(60,66,74,.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const x = 60 + i * 82;
      ctx.beginPath();
      ctx.moveTo(x, 90);
      ctx.lineTo(x, GROUND - 40);
      ctx.stroke();
    }
    ctx.restore();

    // 地面
    ctx.fillStyle = '#d7dae0';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = '#b9bec7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 0.5);
    ctx.lineTo(W, GROUND + 0.5);
    ctx.stroke();

    // 地面纹理
    ctx.save();
    ctx.strokeStyle = 'rgba(120,126,136,.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND + 8);
      ctx.lineTo(x + 22, GROUND + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function bar(x, y, w, h, ratio, color, bg = 'rgba(0,0,0,.12)') {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawHUD() {
    const p = game.player;
    const b = game.boss;

    // 玩家
    bar(28, 26, 260, 14, p.hp / p.maxHp, '#e03131');
    bar(28, 44, 200, 8, p.posture / p.maxPosture, '#f59f00');
    ctx.fillStyle = '#495057';
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('你', 28, 18);

    // Boss
    if (b) {
      const name = b.def.name + (b.phase2 ? '（二阶段）' : '');
      ctx.textAlign = 'right';
      ctx.fillStyle = '#343a40';
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.fillText(name, W - 28, 18);
      bar(W - 28 - 300, 26, 300, 14, Math.max(0, b.hp) / b.maxHp, '#343a40');
      bar(W - 28 - 300, 44, 300, 8, b.posture / b.maxPosture, '#f59f00');
    }

    // 中央提示（死亡/通关时不要重复显示，overlay 已经有大字）
    if (game.messageT > 0 && game.message && game.state === 'playing') {
      ctx.save();
      const a = clamp(game.messageT, 0, 1);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#212529';
      ctx.font = '600 30px "Microsoft YaHei", sans-serif';
      ctx.fillText(game.message, W / 2, 170);
      ctx.restore();
    }
  }

  function drawOverlay() {
    ctx.save();
    ctx.textAlign = 'center';

    if (game.state === 'menu') {
      ctx.fillStyle = 'rgba(242,243,245,.92)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#212529';
      ctx.font = '700 44px "Microsoft YaHei", sans-serif';
      ctx.fillText('火柴人剑斗', W / 2, 170);
      ctx.font = '20px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#495057';
      ctx.fillText('三场 Boss 战', W / 2, 208);

      ctx.font = '16px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#343a40';
      const touch = document.body.classList.contains('touch');
      const lines = touch
        ? [
          '左下 ◀ ▶  移动　　右下  跳 / 攻 / 挡',
          '「挡」按下瞬间 = 弹反（不受伤，且大幅增加对手架势）',
          '打满对方架势 或 打空血量 都能赢',
          '点屏幕开始 / 重来',
        ]
        : [
          'A / D  移动　　空格  跳跃',
          '左键  攻击　　右键  格挡（按下瞬间 = 弹反）',
          '弹反不受伤，且大幅增加对手架势；打满架势或打空血都能赢',
          'R 重开本场　Esc 暂停',
        ];
      lines.forEach((t, i) => ctx.fillText(t, W / 2, 285 + i * 30));

      ctx.fillStyle = '#1c7ed6';
      ctx.font = '600 20px "Microsoft YaHei", sans-serif';
      ctx.fillText(touch ? '点一下屏幕开始' : '按 空格 / 回车 开始', W / 2, 430);
    }

    if (game.state === 'dead') {
      ctx.fillStyle = 'rgba(20,22,26,.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '700 52px "Microsoft YaHei", sans-serif';
      ctx.fillText('你死了', W / 2, H / 2 - 10);
      ctx.font = '18px "Microsoft YaHei", sans-serif';
      ctx.fillText(document.body.classList.contains('touch') ? '点屏幕重来' : 'R 或 空格 重来', W / 2, H / 2 + 40);
    }

    if (game.state === 'cleared') {
      ctx.fillStyle = 'rgba(242,243,245,.95)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#212529';
      ctx.font = '700 46px "Microsoft YaHei", sans-serif';
      ctx.fillText('全部通关', W / 2, H / 2 - 20);
      ctx.font = '18px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#495057';
      ctx.fillText(document.body.classList.contains('touch') ? '点屏幕从第一场重新开始' : '按 空格 从第一场重新开始', W / 2, H / 2 + 36);
    }

    if (game.state === 'paused') {
      ctx.fillStyle = 'rgba(20,22,26,.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '700 40px "Microsoft YaHei", sans-serif';
      ctx.fillText('暂停', W / 2, H / 2);
      ctx.font = '16px "Microsoft YaHei", sans-serif';
      ctx.fillText('Esc 继续　R 重开', W / 2, H / 2 + 38);
    }

    ctx.restore();
  }

  function render() {
    const shakeX = game.shakeT > 0 ? rand(-game.shakeMag, game.shakeMag) : 0;
    const shakeY = game.shakeT > 0 ? rand(-game.shakeMag, game.shakeMag) * 0.6 : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawBackground();

    if (game.boss) game.boss.draw();
    game.player.draw();

    for (const w of game.waves) w.draw();
    for (const b of game.bullets) b.draw();

    // 落雷预警
    for (const L of game.lightning) {
      if (!L.struck) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(now() * 24);
        ctx.strokeStyle = '#7048e8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(L.x - 26, GROUND);
        ctx.lineTo(L.x + 26, GROUND);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawFx();
    ctx.restore();

    drawHUD();
    drawOverlay();

    if (DEBUG.hud) {
      const p = game.player;
      const b = game.boss;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.fillRect(8, H - 74, 470, 56);
      ctx.fillStyle = '#9ae6b4';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      const d = b ? Math.abs(p.x - b.x).toFixed(0) : '-';
      ctx.fillText(`player x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} ${p.state} hp=${p.hp.toFixed(0)} posture=${p.posture.toFixed(0)}`, 14, H - 54);
      ctx.fillText(`boss   x=${b ? b.x.toFixed(0) : '-'} ${b ? b.state : '-'} hp=${b ? b.hp.toFixed(0) : '-'} posture=${b ? b.posture.toFixed(0) : '-'}`, 14, H - 38);
      ctx.fillText(`dist=${d}  bullets=${game.bullets.length} waves=${game.waves.length} lightning=${game.lightning.length}`, 14, H - 22);
      ctx.fillText(`win=${innerWidth}x${innerHeight}  css=${canvas.style.width}x${canvas.style.height}  dpr=${devicePixelRatio}`, 14, H - 6);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 主循环
  let last = performance.now() / 1000;
  function loop() {
    const t = performance.now() / 1000;
    let dt = t - last;
    last = t;
    dt = Math.min(dt, 1 / 30);   // 防止切标签页后瞬移

    if (game.state === 'playing' || game.state === 'dead' || game.state === 'cleared') {
      update(dt);
    } else {
      // 菜单/暂停时也让特效衰减
      updateFx(dt);
    }
    render();

    if (DEBUG.fps) {
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`FPS ${(1 / Math.max(dt, 0.0001)).toFixed(0)}`, 8, H - 8);
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }

  // 调试：自动操作（也用于快进验证）
  function autoStep(tick) {
    const p = game.player;
    const b = game.boss;
    if (!b || !p.alive) return;
    const dist = Math.abs(b.x - p.x);
    input.right = false;
    input.left = false;
    if (dist > 78) {
      if (b.x > p.x) input.right = true; else input.left = true;
    } else if (tick % 10 === 0) {
      input.attackQueued = 0.12;
    }
    // 看到起手就试着弹反
    if (b.state === 'windup' && tick % 6 === 0) {
      input.blockHeld = true;
      input.parryPressedAt = now();
    }
    if (tick % 17 === 0) input.jumpQueued = 0.12;
    if (tick % 9 === 5) input.blockHeld = false;
  }

  if (DEBUG.auto || DEBUG.ff > 0) {
    game.bossIndex = DEBUG.boss ? DEBUG.boss - 1 : 0;
    game.spawnBoss();
    game.state = 'playing';

    if (DEBUG.ff > 0) {
      const step = 1 / 60;
      vclock = 0;
      let tick = 0;
      const frames = Math.round(DEBUG.ff / step);
      for (let i = 0; i < frames; i++) {
        tick++;
        vclock += step;
        if (DEBUG.auto) autoStep(tick);
        update(step);
        if (game.state !== 'playing') break;
      }
      vclock = null;
    }

    if (DEBUG.auto) {
      let tick = 0;
      setInterval(() => { tick++; autoStep(tick); }, 90);
    }
  }

  // 效果自检：一次性摆出所有需要验证的视觉元素（弹幕 / 落雷 / 冲击波 / 火花）
  if (DEBUG.vcheck) {
    game.bossIndex = 0;
    game.spawnBoss();
    game.state = 'playing';
    game.boss.intro = 0;
    game.boss.x = 660;
    game.boss.state = 'windup';
    game.boss.move = BOSS_DEFS[0].moves[0];
    game.boss.stateT = 0.2;
    game.player.x = 300;
    game.messageT = 0;

    for (let i = -2; i <= 2; i++) {
      const a = -0.5 + i * 0.25;
      game.bullets.push(new Bullet(660, 300, Math.cos(a) * 90, Math.sin(a) * 90, 7, 8, i % 2 ? 'arrow' : 'orb'));
    }
    game.waves.push(new Shockwave(520, 1), new Shockwave(760, -1));
    game.lightning.push({ x: 300, t: 0.6, struck: false, dmg: 0 });
    spark(480, 380, 12, '#ffe066', 200);
    vclock = 0.1;
  }

  requestAnimationFrame(loop);
})();
