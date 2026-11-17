export function isTransportShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest(
    'input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), ' +
    '[role="button"], [role="slider"], [role="switch"], [role="combobox"], ' +
    '[role="tab"], [role^="menuitem"], [role="option"], [tabindex]',
  )
}
