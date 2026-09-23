/** Returns a canvas 2D context or fails when the browser cannot provide one. */
export function get2DContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}
