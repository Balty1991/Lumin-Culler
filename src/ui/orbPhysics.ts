/**
 * Un arc amortizat pentru nivelul lichidului din sferă.
 * Integrare semi-implicită, cu pasul limitat ca un cadru lung să nu explodeze.
 */
export interface Spring {
  value: number;
  velocity: number;
}

export function stepSpring(spring: Spring, target: number, dtSeconds: number, stiffness = 84, damping = 14): Spring {
  const dt = Math.min(0.032, Math.max(0, dtSeconds));
  const force = (target - spring.value) * stiffness;
  const velocity = (spring.velocity + force * dt) * Math.exp(-damping * dt);
  return { value: spring.value + velocity * dt, velocity };
}
