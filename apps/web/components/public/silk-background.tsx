"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { STAAASH_BRONZE_HEX } from "@/lib/brand";
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

const canUseAnimatedSilk = () => {
  if (!supportsWebGl()) {
    return false;
  }

  const connection = (
    navigator as Navigator & {
      connection?: {
        effectiveType?: string;
        saveData?: boolean;
      };
    }
  ).connection;
  const lowPowerConnection =
    connection?.saveData ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g";
  const constrainedCpu =
    typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency <= 4;

  return !lowPowerConnection && !constrainedCpu;
};

export function SilkBackground({
  className,
  opacity = 0.62,
  color = STAAASH_BRONZE_HEX,
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
          canUseAnimatedSilk() &&
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
