import type { ComponentType } from "react";

type SilkProps = {
  speed?: number;
  scale?: number;
  color?: string;
  noiseIntensity?: number;
  rotation?: number;
};

declare const Silk: ComponentType<SilkProps>;

export default Silk;
