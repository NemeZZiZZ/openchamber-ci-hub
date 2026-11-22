// Key prefixes each small bundle carries. test/bundleStrings.test.ts fails
// when a bundle's code asks for a key outside its list.

export const BACKGROUND_KEYS = ['background.', 'port.'] as const;
export const BLOCK_KEYS = ['block.', 'port.', 'con.'] as const;

export const SURFACE_KEYS = { background: BACKGROUND_KEYS, block: BLOCK_KEYS } as const;
export type Surface = keyof typeof SURFACE_KEYS;
