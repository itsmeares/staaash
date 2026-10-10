"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// "Halftone fine": dots on a slowly drifting noise field, in Stone night
// colors. Plain WebGL, one full-screen triangle, no library.
const VERTEX = `attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const FRAGMENT = `precision highp float;varying vec2 vUv;uniform float t;uniform vec2 res;
uniform vec3 c1;uniform vec3 c2;uniform vec3 c3;uniform vec3 c4;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+1.),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
 for(int i=0;i<5;i++){v+=a*n(p);p=m*p;a*=.5;}return v;}
float vig(){return .75+.25*smoothstep(1.3,.2,length(vUv-.5));}
float grain(){return (h(gl_FragCoord.xy+fract(t*7.))-.5)*.045;}
void main(){float as=res.x/res.y;vec2 g=vUv*vec2(as,1.)*60.;vec2 id=floor(g),f=fract(g)-.5;
 float v=smoothstep(.32,.78,fbm(id*.04+vec2(.05*t,.025*t)));float r=.04+.42*v;
 float d=1.-smoothstep(r-.07,r,length(f));vec3 dt=mix(c2*1.3,mix(c3,c4,v*.6),v);
 gl_FragColor=vec4(mix(c1,dt,d)*vig()+grain(),1.);}`;

const COLORS = {
  c1: [0x0d, 0x0b, 0x09],
  c2: [0x2a, 0x23, 0x1b],
  c3: [0xa6, 0x8b, 0x5b],
  c4: [0xe8, 0xcf, 0x9c],
} as const;

const FRAME_MS = 1000 / 30;

/**
 * The halftone field. `still` draws one frame and stops, for reduced motion
 * and slow devices. The loop runs at 30 fps at most and pauses while the
 * tab is hidden.
 */
export function Halftone({
  className,
  still = false,
}: {
  className?: string;
  still?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!canvas || !gl) return;

    const shader = (type: number, source: string) => {
      const created = gl.createShader(type)!;
      gl.shaderSource(created, source);
      gl.compileShader(created);
      return created;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const [name, rgb] of Object.entries(COLORS)) {
      gl.uniform3f(
        gl.getUniformLocation(program, name),
        rgb[0] / 255,
        rgb[1] / 255,
        rgb[2] / 255,
      );
    }
    const timeUniform = gl.getUniformLocation(program, "t");
    const resUniform = gl.getUniformLocation(program, "res");

    const resize = () => {
      // Half resolution on dense screens: the dots stay sharp, the GPU idles.
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resUniform, canvas.width, canvas.height);
    };
    const draw = (seconds: number) => {
      gl.uniform1f(timeUniform, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (still) draw(8);
    });
    observer.observe(canvas);

    let frame = 0;
    let last = 0;
    const start = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      draw((now - start) / 1000 + 8);
    };
    if (still) draw(8);
    else frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [still]);

  return (
    <canvas
      aria-hidden
      className={cn("block size-full bg-[#0d0b09]", className)}
      ref={canvasRef}
    />
  );
}
