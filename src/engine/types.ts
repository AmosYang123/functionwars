export interface Vec {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type Shape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'poly'; pts: Vec[] };

export type ObstacleKind = 'boulder' | 'wall' | 'triangle' | 'star';

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  shape: Shape;
  /** Unbreakable: missiles bounce off without leaving a crater. */
  solid?: boolean;
}

/** A hole a missile blasted. Breakable obstacles are solid only outside every crater. */
export interface Crater {
  x: number;
  y: number;
  r: number;
}

/** Anything round that a shot can hit: players, dummies. */
export interface Actor {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface Arena {
  bounds: Bounds;
  obstacles: Obstacle[];
  actors: Actor[];
  craters?: Crater[];
}

/** +1 fires toward +x, -1 fires toward -x. */
export type Facing = 1 | -1;

export type FamilyId = 'linear' | 'quadratic' | 'absolute' | 'cubic' | 'sqrt' | 'exponential' | 'log' | 'sine' | 'tangent';
export type Family = FamilyId | 'constant' | 'other';

export type EndReason = 'bounds' | 'undefined' | 'asymptote' | 'range' | 'hit';

export interface Hit {
  type: 'actor' | 'obstacle';
  id: string;
  x: number;
  y: number;
}

export interface Trace {
  /** Flat [x0, y0, x1, y1, ...] world coordinates, truncated at the hit. */
  pts: number[];
  hit: Hit | null;
  end: EndReason;
  length: number;
  /** Obstacles a Drill shot passed straight through. */
  drilled?: string[];
}

/** Power-up effects on one shot. */
export interface ShotOptions {
  /** How many obstacles the shot passes through (Drill). */
  pierce?: number;
  /** Players count as this many times bigger (Mega Blast). */
  reach?: number;
}
