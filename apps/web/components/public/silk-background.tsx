"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type SilkCanvasProps = {
  speed?: number;
  scale?: number;
  color?: string;
  noiseIntensity?: number;
  rotation?: number;
};

const SilkCanvas = dynamic<SilkCanvasProps>(() => import("@/components/Silk"), {
  ssr: false,
});

type SilkBackgroundProps = SilkCanvasProps & {
  className?: string;
  opacity?: number;
};

const supportsWebGl = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
};

export function SilkBackground({
  className,
  opacity = 0.62,
  color = "#78c8c6",
  speed = 4.4,
  scale = 1.08,
  noiseIntensity = 1.15,
  rotation = 0.08,
}: SilkBackgroundProps) {
  const [canAnimate, setCanAnimate] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopQuery = window.matchMedia("(min-width: 960px)");

    const update = () => {
      setCanAnimate(
        document.visibilityState === "visible" &&
          desktopQuery.matches &&
          supportsWebGl() &&
          !motionQuery.matches,
      );
    };

    update();
    motionQuery.addEventListener("change", update);
    desktopQuery.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      motionQuery.removeEventListener("change", update);
      desktopQuery.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn("entry-silk", className)}
      style={{ opacity }}
    >
      <div className="entry-silk-fallback" />
      {canAnimate ? (
        <div className="absolute inset-0">
          <SilkCanvas
            color={color}
            noiseIntensity={noiseIntensity}
            rotation={rotation}
            scale={scale}
            speed={speed}
          />
        </div>
      ) : null}
    </div>
  );
}
