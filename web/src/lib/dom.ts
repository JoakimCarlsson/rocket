/**
 * Spread onto a button whose disabled state is rendered. It stops Firefox restoring the
 * state the button had before a reload, which then no longer matches the server HTML and
 * breaks hydration. Spread rather than written out, because React's button props omit it.
 */
export const NO_RESTORE: Record<string, string> = { autoComplete: "off" };
