export const CURSOR_PALETTE = [
  "#F87171",
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#A78BFA",
  "#F472B6",
  "#22D3EE",
  "#FACC15",
  "#FB923C",
  "#4ADE80",
];

export function pickColorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CURSOR_PALETTE[Math.abs(h) % CURSOR_PALETTE.length]!;
}
