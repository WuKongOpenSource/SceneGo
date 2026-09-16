// Presentation only: never use these labels as model IDs or provenance evidence.
export function compactImageModelLabel(label: string): string {
  return label
    .replace(/^Gemini[\s-]+(3\.1|2\.5)(?:[\s-]+Flash[\s-]+Image(?:[\s-]+Preview)?)?/i, 'Gemini $1')
    .replace(/^Doubao[- ]Seedream[- ]5[.-]0[- ]Lite/i, 'Seedream 5.0 Lite')
    .replace(/^Doubao[- ]Seedream[- ]5[.-]0[- ]Pro/i, 'Seedream 5.0 Pro')
    .replace(/^doubao(?=\s*·|$)/i, 'Seedream');
}

export function compactImageSourceLabel(label: string): string {
  // Preserve the recorded method/purpose; do not guess a version for old aliases.
  return compactImageModelLabel(label).replace(/^Gemini[^·]*(?=·|$)/i, match => (
    match.endsWith(' ') ? 'Gemini ' : 'Gemini'
  ));
}
