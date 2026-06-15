declare module 'd3-force-3d' {
  interface PositioningForce {
    (alpha: number): void;
    strength(s: number): PositioningForce;
    initialize(nodes: unknown[], random?: () => number): void;
  }
  export function forceX(x?: number): PositioningForce;
  export function forceY(y?: number): PositioningForce;
  export function forceZ(z?: number): PositioningForce;
}
