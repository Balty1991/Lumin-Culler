/**
 * ui/motion.ts
 * Curba de easing pentru intrarile/iesirile Framer Motion — trebuie sa fie
 * IDENTICA cu variabila CSS `--ease` (styles.css) ca tranzitiile framer-motion
 * si cele CSS sa aiba acelasi "feel". Un singur loc, nu duplicata (fostul risc:
 * era redeclarata identic in MenuDrawer.tsx, CommandPalette.tsx, DetailView.tsx).
 */
export const EASE = [0.16, 1, 0.3, 1] as const;
