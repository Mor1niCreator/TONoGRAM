import Matter from 'matter-js';
const { Engine, World, Bodies, Body, Events, Vector } = Matter;
import { GAME_WIDTH, GAME_HEIGHT, PUCK_RADIUS, MALLET_RADIUS, GOAL_WIDTH } from '../shared/constants.js';

export class GameRoom {
  engine: Matter.Engine;
  puck: Matter.Body;
  player1: Matter.Body;
  player2: Matter.Body;
  
  score = { p1: 0, p2: 0 };
  
  onStateUpdate: (state: any) => void;
  onGoal: (playerIndex: number) => void;
  onGameOver: (winner: number) => void;

  updateInterval: NodeJS.Timeout | null = null;
  syncInterval: NodeJS.Timeout | null = null;
  powerupInterval: NodeJS.Timeout | null = null;

  powerups: any[] = [];
  
  // Powerup state tracking to prevent scaling bugs
  activePowerupStates = {
    p1: { isBig: false, timeout: null as NodeJS.Timeout | null },
    p2: { isBig: false, timeout: null as NodeJS.Timeout | null }
  };

  // Set of all active timeouts to prevent memory leaks on teardown
  private timeouts: Set<NodeJS.Timeout> = new Set();
  private stuckTicks = 0;

  constructor(
    public roomId: string, 
    public p1Id: string, 
    public p2Id: string,
    callbacks: any
  ) {
    this.onStateUpdate = callbacks.onStateUpdate;
    this.onGoal = callbacks.onGoal;
    this.onGameOver = callbacks.onGameOver;

    this.engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    
    // Create bounds
    const wallOptions = { isStatic: true, restitution: 1.0, friction: 0 };
    const leftWall = Bodies.rectangle(10, GAME_HEIGHT / 2, 20, GAME_HEIGHT, wallOptions);
    const rightWall = Bodies.rectangle(GAME_WIDTH - 10, GAME_HEIGHT / 2, 20, GAME_HEIGHT, wallOptions);
    
    // Top and bottom walls (with gaps for goals)
    const wallWidth = (GAME_WIDTH - GOAL_WIDTH) / 2;
    // Top Wall 1 & 2
    const topWall1 = Bodies.rectangle(wallWidth / 2, 10, wallWidth, 20, wallOptions);
    const topWall2 = Bodies.rectangle(GAME_WIDTH - wallWidth / 2, 10, wallWidth, 20, wallOptions);
    
    // Bottom Wall 1 & 2
    const botWall1 = Bodies.rectangle(wallWidth / 2, GAME_HEIGHT - 10, wallWidth, 20, wallOptions);
    const botWall2 = Bodies.rectangle(GAME_WIDTH - wallWidth / 2, GAME_HEIGHT - 10, wallWidth, 20, wallOptions);

    // Goal side posts to prevent puck from escaping bounds laterally when entering the goal area
    const topGoalPostL = Bodies.rectangle(wallWidth, -10, 10, 40, wallOptions);
    const topGoalPostR = Bodies.rectangle(GAME_WIDTH - wallWidth, -10, 10, 40, wallOptions);
    const botGoalPostL = Bodies.rectangle(wallWidth, GAME_HEIGHT + 10, 10, 40, wallOptions);
    const botGoalPostR = Bodies.rectangle(GAME_WIDTH - wallWidth, GAME_HEIGHT + 10, 10, 40, wallOptions);

    // Goal sensors
    const topGoal = Bodies.rectangle(GAME_WIDTH / 2, -20, GOAL_WIDTH, 40, { isStatic: true, isSensor: true, label: 'goal_p2' });
    const botGoal = Bodies.rectangle(GAME_WIDTH / 2, GAME_HEIGHT + 20, GOAL_WIDTH, 40, { isStatic: true, isSensor: true, label: 'goal_p1' });

    // Midline for logical separation
    const midline = Bodies.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, 10, { isStatic: true, isSensor: true, label: 'midline' });

    // Puck
    this.puck = Bodies.circle(GAME_WIDTH / 2, GAME_HEIGHT / 2, PUCK_RADIUS, {
      restitution: 0.9,
      friction: 0.005,
      frictionAir: 0.015,
      mass: 0.5,
      label: 'puck'
    });

    // Mallets
    const malletOptions = {
      restitution: 0.5,
      friction: 0,
      frictionAir: 0.1,
      mass: 5
    };
    this.player1 = Bodies.circle(GAME_WIDTH / 2, GAME_HEIGHT - 100, MALLET_RADIUS, { ...malletOptions, label: 'p1_mallet' });
    this.player2 = Bodies.circle(GAME_WIDTH / 2, 100, MALLET_RADIUS, { ...malletOptions, label: 'p2_mallet' });

    World.add(this.engine.world, [
      leftWall, rightWall, topWall1, topWall2, botWall1, botWall2,
      topGoalPostL, topGoalPostR, botGoalPostL, botGoalPostR,
      topGoal, botGoal, midline,
      this.puck, this.player1, this.player2
    ]);

    Events.on(this.engine, 'collisionStart', this.handleCollisions.bind(this));
  }

  private setGameTimeout(fn: () => void, delay: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timeouts.delete(timer);
      fn();
    }, delay);
    this.timeouts.add(timer);
    return timer;
  }

  private clearGameTimeout(timer: NodeJS.Timeout | null) {
    if (timer) {
      clearTimeout(timer);
      this.timeouts.delete(timer);
    }
  }

  start() {
    this.updateInterval = setInterval(() => {
      // Sub-stepping physics for collision precision with fast pucks
      Engine.update(this.engine, 1000 / 120);
      Engine.update(this.engine, 1000 / 120);
      this.constrainMallets();
      this.checkSpeed();
    }, 1000 / 60);

    this.syncInterval = setInterval(() => {
      this.onStateUpdate(this.getState());
    }, 1000 / 30);

    this.powerupInterval = setInterval(() => {
      this.spawnPowerup();
    }, 8000);
  }

  stop() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.powerupInterval) clearInterval(this.powerupInterval);
    
    // Safely clear all active timeouts to prevent memory leaks
    this.timeouts.forEach(timer => clearTimeout(timer));
    this.timeouts.clear();
  }

  getState() {
    return {
      puck: { 
        x: this.puck.position.x, 
        y: this.puck.position.y,
        vx: this.puck.velocity.x,
        vy: this.puck.velocity.y
      },
      p1: { x: this.player1.position.x, y: this.player1.position.y, radius: this.player1.circleRadius || MALLET_RADIUS },
      p2: { x: this.player2.position.x, y: this.player2.position.y, radius: this.player2.circleRadius || MALLET_RADIUS },
      score: this.score,
      powerups: this.powerups.map(p => ({ x: p.body.position.x, y: p.body.position.y, type: p.type, id: p.id }))
    };
  }

  applyInput(playerId: string, targetX: number, targetY: number) {
    const isP1 = playerId === this.p1Id;
    const mallet = isP1 ? this.player1 : this.player2;
    const radius = mallet.circleRadius || MALLET_RADIUS;
    
    // Bounds check target based on half using dynamic radius (mallet scale updates)
    let constrainedY = targetY;
    if (isP1) {
      constrainedY = Math.max(GAME_HEIGHT / 2 + radius, Math.min(GAME_HEIGHT - radius, targetY));
    } else {
      constrainedY = Math.max(radius, Math.min(GAME_HEIGHT / 2 - radius, targetY));
    }
    const constrainedX = Math.max(radius, Math.min(GAME_WIDTH - radius, targetX));

    // Anti-cheat velocity controls: clamp mallet movement to maximum safe speed
    const dx = constrainedX - mallet.position.x;
    const dy = constrainedY - mallet.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    const MAX_SPEED = 30; // Max pixels traveled in one tick
    let finalX = constrainedX;
    let finalY = constrainedY;
    if (distance > MAX_SPEED) {
      finalX = mallet.position.x + (dx / distance) * MAX_SPEED;
      finalY = mallet.position.y + (dy / distance) * MAX_SPEED;
    }
    
    // Set velocity directly for responsive control
    Body.setVelocity(mallet, { 
      x: (finalX - mallet.position.x) * 0.4, 
      y: (finalY - mallet.position.y) * 0.4 
    });
  }

  // Prevent mallets from crossing midline
  constrainMallets() {
    const r1 = this.player1.circleRadius || MALLET_RADIUS;
    if (this.player1.position.y < GAME_HEIGHT / 2 + r1) {
      Body.setPosition(this.player1, { x: this.player1.position.x, y: GAME_HEIGHT / 2 + r1 });
      Body.setVelocity(this.player1, { x: this.player1.velocity.x, y: 0 });
    }
    
    const r2 = this.player2.circleRadius || MALLET_RADIUS;
    if (this.player2.position.y > GAME_HEIGHT / 2 - r2) {
      Body.setPosition(this.player2, { x: this.player2.position.x, y: GAME_HEIGHT / 2 - r2 });
      Body.setVelocity(this.player2, { x: this.player2.velocity.x, y: 0 });
    }
  }

  // Prevent puck from getting stuck or too fast
  checkSpeed() {
    const speed = Vector.magnitude(this.puck.velocity);
    
    // 1. Limit max speed to prevent physics tunneling
    if (speed > 25) {
      Body.setVelocity(this.puck, Vector.mult(Vector.normalise(this.puck.velocity), 25));
    }
    
    // 2. Prevent puck from sitting dead / getting stuck in corners or deadzones
    if (speed < 0.5) {
      this.stuckTicks++;
      // If stuck for 2 seconds (120 ticks at 60 FPS)
      if (this.stuckTicks > 120) {
        this.stuckTicks = 0;
        // Apply gentle diagonal push towards middle
        const forceX = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2);
        const forceY = (this.puck.position.y > GAME_HEIGHT / 2 ? -1 : 1) * (3 + Math.random() * 2);
        Body.setVelocity(this.puck, { x: forceX, y: forceY });
      }
    } else {
      this.stuckTicks = 0;
    }

    // 3. Keep puck within boundaries if it somehow glitched out
    const px = this.puck.position.x;
    const py = this.puck.position.y;
    if (px < 0 || px > GAME_WIDTH || py < -50 || py > GAME_HEIGHT + 50) {
      this.resetPuck(py > GAME_HEIGHT / 2);
    }
  }

  resetPuck(scorerIsP1: boolean) {
    Body.setPosition(this.puck, { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 });
    Body.setVelocity(this.puck, { x: 0, y: scorerIsP1 ? -5 : 5 });
  }

  handleCollisions(event: Matter.IEventCollision<Matter.Engine>) {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      if (bodyA.label === 'puck' && bodyB.label.startsWith('goal')) {
        this.scoreGoal(bodyB.label);
      } else if (bodyB.label === 'puck' && bodyA.label.startsWith('goal')) {
        this.scoreGoal(bodyA.label);
      } else if ((bodyA.label.includes('mallet') && bodyB.label === 'powerup') || (bodyB.label.includes('mallet') && bodyA.label === 'powerup')) {
        const powerup = bodyA.label === 'powerup' ? bodyA : bodyB;
        const malletLabel = bodyA.label.includes('mallet') ? bodyA.label : bodyB.label;
        this.activatePowerup(powerup, malletLabel);
      }
    });
  }

  scoreGoal(goalLabel: string) {
    if (goalLabel === 'goal_p1') {
      this.score.p2 += 1;
      this.onGoal(2);
      this.resetPuck(false);
    } else {
      this.score.p1 += 1;
      this.onGoal(1);
      this.resetPuck(true);
    }

    if (this.score.p1 >= 7) {
      this.onGameOver(1);
    } else if (this.score.p2 >= 7) {
      this.onGameOver(2);
    }
  }

  spawnPowerup() {
    if (this.powerups.length >= 2) return;
    
    const types = ['BIG_MALLET', 'SPEED_PUCK'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    const yOffsets = [GAME_HEIGHT/4, GAME_HEIGHT*0.75];
    const item = Bodies.circle(
      50 + Math.random() * (GAME_WIDTH - 100),
      yOffsets[Math.floor(Math.random() * yOffsets.length)],
      20,
      { isStatic: true, isSensor: true, label: 'powerup' }
    );
    
    const id = Math.random().toString();
    (item as any).powerupData = { type, id };
    
    this.powerups.push({ body: item, type, id });
    World.add(this.engine.world, item);

    this.setGameTimeout(() => {
      this.removePowerup(id);
    }, 7000);
  }

  removePowerup(id: string) {
    const idx = this.powerups.findIndex(p => p.id === id);
    if (idx !== -1) {
      World.remove(this.engine.world, this.powerups[idx].body);
      this.powerups.splice(idx, 1);
    }
  }

  activatePowerup(powerupBody: Matter.Body, malletLabel: string) {
    const data = (powerupBody as any).powerupData;
    if (!data) return;

    this.removePowerup(data.id);

    const isP1 = malletLabel === 'p1_mallet';
    const playerKey = isP1 ? 'p1' : 'p2';
    
    if (data.type === 'BIG_MALLET') {
      const mallet = isP1 ? this.player1 : this.player2;
      const state = this.activePowerupStates[playerKey];
      
      if (state.isBig) {
        // Refresh effect duration without scaling mallets exponentially
        this.clearGameTimeout(state.timeout);
        state.timeout = this.setGameTimeout(() => {
          Body.scale(mallet, 1 / 1.5, 1 / 1.5);
          state.isBig = false;
          state.timeout = null;
        }, 5000);
      } else {
        // First scale
        state.isBig = true;
        Body.scale(mallet, 1.5, 1.5);
        state.timeout = this.setGameTimeout(() => {
          Body.scale(mallet, 1 / 1.5, 1 / 1.5);
          state.isBig = false;
          state.timeout = null;
        }, 5000);
      }
    } else if (data.type === 'SPEED_PUCK') {
      const v = this.puck.velocity;
      Body.setVelocity(this.puck, Vector.mult(v, 1.5));
    }
  }
}
