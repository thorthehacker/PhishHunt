"use client";

// React Bits "Squares" background (reactbits.dev):
// a canvas grid where cells light up near the cursor and fade inward
// along an animated sweep direction.
import { useEffect, useRef } from "react";

interface SquaresProps {
  direction?: "diagonal" | "up" | "right" | "down" | "left" | "upRight" | "downRight" | "downLeft" | "upLeft";
  speed?: number;
  borderColor?: string;
  squareSize?: number;
  hoverFillColor?: string;
  className?: string;
}

interface SquareEntry {
  x: number;
  y: number;
  value: number; // 0..1 glow intensity
}

export default function Squares({
  direction = "diagonal",
  speed = 1,
  borderColor = "#3f3f46",
  squareSize = 40,
  hoverFillColor = "#7f1d1d",
  className,
}: SquaresProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const squaresRef = useRef<SquareEntry[]>([]);
  const requestRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [dx, dy] =
      direction === "diagonal" ? [1, 1] :
      direction === "up" ? [0, -1] :
      direction === "down" ? [0, 1] :
      direction === "left" ? [-1, 0] :
      direction === "right" ? [1, 0] :
      direction === "upRight" ? [1, -1] :
      direction === "upLeft" ? [-1, -1] :
      direction === "downRight" ? [1, 1] : [-1, 1];

    let numSquaresX = 0;
    let numSquaresY = 0;
    const dpr = Math.max(window.devicePixelRatio || 1, 1);

    const resizeCanvas = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      numSquaresX = Math.ceil(width / squareSize) + 1;
      numSquaresY = Math.ceil(height / squareSize) + 1;
      squaresRef.current = [];
    };

    const glow = (d: number): number => Math.max(0, 1 - d / (squareSize * 2.5));

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const hover = hoverRef.current;

      for (let i = 0; i < numSquaresX; i++) {
        for (let j = 0; j < numSquaresY; j++) {
          let intensity = 0;

          // Cursor glow + registered trail values
          if (hover) {
            const d = Math.sqrt((i - hover.x) ** 2 + (j - hover.y) ** 2);
            intensity = Math.max(intensity, glow(d));
          }
          const entry = squaresRef.current.find((sq) => sq.x === i && sq.y === j);
          if (entry && entry.value > 0) intensity = Math.max(intensity, entry.value);

          if (intensity > 0) {
            ctx.globalAlpha = Math.min(1, intensity);
            ctx.fillStyle = hoverFillColor;
            ctx.fillRect(i * squareSize, j * squareSize, squareSize, squareSize);
            ctx.globalAlpha = 1;
          }

          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(i * squareSize, j * squareSize, squareSize, squareSize);
        }
      }
      ctx.restore();
    };

    const frame = (now: number) => {
      const elapsed = lastFrameRef.current ? now - lastFrameRef.current : 0;
      lastFrameRef.current = now;

      // Fade existing trail values and sweep them along the direction.
      const arr = squaresRef.current;
      for (let i = arr.length - 1; i >= 0; i--) {
        const sq = arr[i];
        sq.value -= (elapsed / 1000) * speed;
        if (sq.value <= 0) {
          arr.splice(i, 1);
          continue;
        }
        const nx = sq.x + dx;
        const ny = sq.y + dy;
        if (nx < 0 || nx >= numSquaresX || ny < 0 || ny >= numSquaresY) {
          sq.value = 0;
          continue;
        }
        let next = arr.find((s) => s.x === nx && s.y === ny);
        if (!next) {
          next = { x: nx, y: ny, value: 0 };
          arr.push(next);
        }
        next.value = Math.max(next.value, sq.value * 0.94);
      }

      drawGrid();
      requestRef.current = requestAnimationFrame(frame);
    };

    const handleMouseMove = (evt: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        hoverRef.current = null;
        return;
      }
      const gx = Math.floor(x / squareSize);
      const gy = Math.floor(y / squareSize);
      if (gx < 0 || gy < 0 || gx >= numSquaresX || gy >= numSquaresY) {
        hoverRef.current = null;
        return;
      }
      hoverRef.current = { x: gx, y: gy };
      // Register a trail seed so the glow keeps sweeping after the cursor leaves.
      const existing = squaresRef.current.find((sq) => sq.x === gx && sq.y === gy);
      if (existing) existing.value = 1;
      else squaresRef.current.push({ x: gx, y: gy, value: 1 });
    };

    const handleMouseLeave = () => {
      hoverRef.current = null;
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    requestRef.current = requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [direction, speed, borderColor, squareSize, hoverFillColor]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
