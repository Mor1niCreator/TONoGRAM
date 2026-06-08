export interface PuckState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface MalletState {
  x: number;
  y: number;
  radius: number;
}

export interface PowerupState {
  id: string;
  x: number;
  y: number;
  type: string;
}

export interface GameState {
  puck: PuckState;
  p1: MalletState;
  p2: MalletState;
  score: { p1: number; p2: number };
  powerups: PowerupState[];
}

export interface PlayerInput {
  x: number;
  y: number;
}
