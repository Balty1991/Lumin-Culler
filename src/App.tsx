/**
 * The cleaner is the mounted UI. Photographer modules — best-shot scoring,
 * XMP export, the grid and review tools — stay in src/core and src/ui.
 * They are not imported here, so they stay out of the boot bundle and out
 * of this navigation. WelcomeOnboarding remains a tested module; the old
 * empty-library marketing lived in the previous shell and is gone.
 */
export { RescueApp as default } from './ui/rescue/RescueApp';
