// A dim bronze pixel field, shaded with ordered dithering, optionally with the
// drive mark drawn in its own colors. The pointer works as a light, and each
// click sends a ring that lights up whatever it passes over. When no pointer
// is over it, the light drifts on its own so the field never sits still.
//
// The canvas reads --px (screen pixels per field pixel) and, for the mark,
// --mark-h and --mark-y (its height and the distance from the top to its
// center, both in CSS pixels). The scene is drawn one pixel per cell and
// scaled up by CSS, which keeps the shader cheap on large screens.

const RINGS = 16;
// A ring lives this long, long enough to cross a wide screen.
const RING_LIFE = 2.6;

const FRAGMENT = `
precision highp float;
uniform vec2 res;
uniform float t;
uniform vec3 ptr;
uniform vec3 rip[${RINGS}];
uniform vec2 mark;
uniform float markH;
uniform float showMark;

float b2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer(vec2 p) { return b2(p * .5) * .25 + b2(p) + .03; }

// Picks a, b or c for shade s in 0..1, dithered between neighbours.
vec3 ramp(vec3 a, vec3 b, vec3 c, float s, float th) {
  s = clamp(s, 0., 1.) * 2.;
  return s < 1. ? (fract(s) > th ? b : a) : (fract(s) > th || s >= 2. ? c : b);
}

float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + 1.), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}

void main() {
  vec2 px = floor(gl_FragCoord.xy);
  px.y = res.y - 1. - px.y;
  float aspect = res.x / res.y;
  vec2 uv = (px + .5) / res.y;
  float th = bayer(px);

  vec2 p = ptr.xy * vec2(aspect, 1.);
  float light = ptr.z * .42 * exp(-dot(uv - p, uv - p) * 14.3);

  float wave = 0., sq = 0.;
  for (int i = 0; i < ${RINGS}; i++) {
    float age = t - rip[i].z;
    if (age > 0. && age < ${RING_LIFE.toFixed(1)}) {
      float d = length(uv - rip[i].xy * vec2(aspect, 1.));
      float e = exp(-pow(d - age * .665, 2.) * 1020.) * (1. - age / ${RING_LIFE.toFixed(1)});
      wave += e;
      sq += e * e;
    }
  }
  // Where rings cross they add up, like waves: the sum of every pair of
  // ring strengths, without comparing each pair.
  float cross = clamp((wave * wave - sq) * .5 * 2.5, 0., 1.);
  wave = min(wave, 1.);

  float g = .28 * smoothstep(.38, .82, fbm(uv * 3. + vec2(t * .08, t * .04))) + light * .8 + wave;
  vec3 col = ramp(vec3(.062, .056, .05), vec3(.17, .13, .09), vec3(.38, .29, .18), g, th);
  if (cross > .02) col = ramp(col, vec3(.72, .57, .36), vec3(.98, .87, .64), cross, th);

  if (showMark > .5) {
    // The mark in its own 36 by 26 units: a slate lid, a gap, a dark body, a blue light.
    vec2 m = (uv - mark * vec2(aspect, 1.)) / markH * 26. + vec2(18., 13.);
    bool lid = m.y > 0. && m.y < 9.6 && m.x > 7. - m.y * 6. / 14. && m.x < 29. + m.y * 6. / 14.;
    float bd = box(m - vec2(18., 18.), vec2(17., 7.), 3.5);
    bool body = bd < 0.;
    bool led = box(m - vec2(26., 17.9), vec2(4., 1.3), 1.3) < 0.;
    vec2 lm = m - vec2(26., 17.9);
    float halo = exp(-dot(lm, lm) * .02) * (.75 + .25 * sin(t * 2.4));
    if (!lid && !body) col = mix(col, vec3(.22, .44, .85), clamp(halo * .8 + wave * halo, 0., .85));
    if (lid) col = ramp(vec3(.34, .36, .41), vec3(.52, .55, .61), vec3(.78, .8, .85), .7 - m.y * .035 + light + wave * 1.4 + cross, th);
    if (body) {
      float s = .55 - (m.y - 11.) * .03 + light + wave * 1.4 + cross;
      col = bd > -1.1
        ? ramp(vec3(.3, .33, .39), vec3(.44, .48, .56), vec3(.66, .7, .78), s, th)
        : ramp(vec3(.12, .15, .2), vec3(.2, .24, .31), vec3(.34, .39, .48), s, th);
    }
    if (led) col = ramp(vec3(.16, .36, .8), vec3(.24, .48, .92), vec3(.38, .62, 1.), .55 + .35 * sin(t * 2.4) + light * .5, th);
  }
  gl_FragColor = vec4(col, 1.);
}`;

const VERTEX =
  "attribute vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }";

function compile(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, "p");
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/**
 * Draws the field into `canvas` and keeps it moving. Returns false when the
 * browser can't draw it, for example with WebGL turned off. Pointer events are read
 * from `host`, so text laid over the canvas still lets them through.
 */
export function startPixelField(canvas: HTMLCanvasElement, host: HTMLElement) {
  const context = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
  });
  if (!context) return false;
  // A non-null name, so the closures below don't have to check again.
  const gl: WebGLRenderingContext = context;
  const program = compile(gl);
  if (!program) return false;
  // shortcut: a lost context (a GPU reset) falls back to the plain logo for
  // the rest of the visit, rebuild the program on webglcontextrestored if
  // that ever matters.
  canvas.addEventListener("webglcontextlost", () =>
    host.classList.add("field-off"),
  );
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);

  // Each click takes the oldest of the ring slots, so fast clicks overlap
  // instead of cutting each other off.
  const rings = new Float32Array(RINGS * 3);
  for (let i = 2; i < rings.length; i += 3) rings[i] = -RING_LIFE;
  gl.uniform3fv(uniform("rip[0]"), rings);
  let nextRing = 0;

  const withMark = canvas.hasAttribute("data-mark");
  gl.uniform1f(uniform("showMark"), withMark ? 1 : 0);

  function layout() {
    const css = getComputedStyle(canvas);
    const size = parseFloat(css.getPropertyValue("--px")) || 6;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth / size));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight / size));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniform("res"), canvas.width, canvas.height);
    if (!withMark) return;
    const height = canvas.clientHeight || 1;
    const markY = parseFloat(css.getPropertyValue("--mark-y")) || 196;
    const markH = parseFloat(css.getPropertyValue("--mark-h")) || 176;
    gl.uniform2f(uniform("mark"), 0.5, markY / height);
    gl.uniform1f(uniform("markH"), markH / height);
  }

  const light = { x: 0.5, y: 0.5, z: 0 };
  const aim = { x: 0.5, y: 0.5, z: 0 };
  let pointerOver = false;
  let now = 0;

  function draw(t: number) {
    now = t;
    gl.uniform1f(uniform("t"), t);
    gl.uniform3f(uniform("ptr"), light.x, light.y, light.z);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  layout();
  new ResizeObserver(() => {
    layout();
    draw(now);
  }).observe(canvas);

  const still = matchMedia("(prefers-reduced-motion: reduce)");
  // With reduced motion the field shows one still frame and waits.
  if (still.matches) draw(4);
  // Reduced motion can also change after the page opened.
  still.addEventListener("change", () => {
    if (still.matches) draw(4);
    else run();
  });

  const at = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return [
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
    ];
  };
  host.addEventListener("pointermove", (event) => {
    [aim.x, aim.y] = at(event);
    aim.z = 1;
    pointerOver = true;
  });
  host.addEventListener("pointerleave", () => {
    pointerOver = false;
  });
  host.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button"))
      return;
    const [x, y] = at(event);
    rings.set([x, y, now], (nextRing++ % RINGS) * 3);
    gl.uniform3fv(uniform("rip[0]"), rings);
  });

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  }).observe(canvas);

  // Start at a random point in time so the field differs on each visit.
  const start = performance.now() - Math.random() * 20000;
  let last = 0;
  // The loop stops while the field is off screen and starts again when it
  // scrolls back, so a hidden field costs nothing.
  let running = false;
  const frame = (ms: number) => {
    if (still.matches || !visible) {
      running = false;
      return;
    }
    requestAnimationFrame(frame);
    // 30 frames a second is enough for pixel art and halves the work.
    if (ms - last < 1000 / 31) return;
    last = ms;
    const t = (ms - start) / 1000;
    if (!pointerOver) {
      aim.x = 0.5 + 0.38 * Math.cos(t * 0.33);
      aim.y = 0.5 + 0.34 * Math.sin(t * 0.51);
      aim.z = 0.75;
    }
    light.x += (aim.x - light.x) * 0.2;
    light.y += (aim.y - light.y) * 0.2;
    light.z += (aim.z - light.z) * 0.1;
    draw(t);
  };
  function run() {
    if (running || still.matches || !visible) return;
    running = true;
    requestAnimationFrame(frame);
  }
  run();
  return true;
}
