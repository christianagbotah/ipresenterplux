export function hasBlockingModal() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('[aria-modal="true"]'));
}
