import * as THREE from 'three';

/**
 * Procedural materials for the marble city. Facades get their windows,
 * shopfronts, floor bands, and glass fins from world-space coordinates in
 * the shader, so any box of any size reads as a building with no textures.
 */

export interface FacadeOptions {
  /** Window bay width (m). */
  bay: number;
  /** Storey height (m). */
  floor: number;
  window: number;
  /** 0..1 how strongly windows show. */
  amount: number;
  /** Ground floor: 1 = tall shopfronts / arcade openings, 0 = blank. */
  ground: number;
  /** Modern glass tower bands instead of punched windows. */
  glass?: boolean;
  roughness?: number;
}

let facadeId = 0;

export function facadeMaterial(o: FacadeOptions): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.roughness ?? 0.62, metalness: 0 });
  const id = ++facadeId;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBay = { value: o.bay };
    shader.uniforms.uFloor = { value: o.floor };
    shader.uniforms.uWindow = { value: new THREE.Color(o.window) };
    shader.uniforms.uAmount = { value: o.amount };
    shader.uniforms.uGround = { value: o.ground };
    shader.uniforms.uGlass = { value: o.glass ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 fPos = vec4(transformed, 1.0);
        vec3 fNor = objectNormal;
        #ifdef USE_INSTANCING
          fPos = instanceMatrix * fPos;
          fNor = mat3(instanceMatrix) * fNor;
        #endif
        vFacadePos = (modelMatrix * fPos).xyz;
        vFacadeNormal = normalize(mat3(modelMatrix) * fNor);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacadePos;
        varying vec3 vFacadeNormal;
        uniform float uBay;
        uniform float uFloor;
        uniform vec3 uWindow;
        uniform float uAmount;
        uniform float uGround;
        uniform float uGlass;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fWin = 0.0;
        {
          vec3 an = abs(vFacadeNormal);
          if (an.y < 0.6) {
            float u = (an.x > an.z) ? vFacadePos.z : vFacadePos.x;
            float v = vFacadePos.y;
            float fl = floor(v / uFloor);
            float fy = fract(v / uFloor);
            float bx = fract(u / uBay + 0.5);
            float cellId = fract(sin(dot(vec2(floor(u / uBay), fl), vec2(12.9898, 78.233))) * 43758.5453);
            if (uGlass > 0.5) {
              float fin = smoothstep(0.86, 0.9, bx);
              float slab = 1.0 - smoothstep(0.1, 0.14, fy);
              fWin = (1.0 - fin) * (1.0 - slab);
            } else {
              float wx = step(0.31, bx) * step(bx, 0.69);
              float wy = step(0.26, fy) * step(fy, 0.8);
              // Arched heads on alternate storeys.
              float arch = (mod(fl, 2.0) < 0.5) ? step(length(vec2((bx - 0.5) / 0.19, (fy - 0.8) / 0.12)), 1.0) : 0.0;
              fWin = max(wx * wy, arch * wx);
              if (fl < 0.5) fWin = uGround * step(0.17, bx) * step(bx, 0.83) * step(0.04, fy) * step(fy, 0.88);
              float band = smoothstep(0.0, 0.05, fy) * (1.0 - smoothstep(0.93, 1.0, fy));
              diffuseColor.rgb *= mix(0.84, 1.0, band);
              float pil = smoothstep(0.0, 0.05, bx) * (1.0 - smoothstep(0.95, 1.0, bx));
              diffuseColor.rgb *= mix(0.9, 1.0, pil);
              float sur = step(0.27, bx) * step(bx, 0.73) * step(0.22, fy) * step(fy, 0.84) * (1.0 - fWin);
              diffuseColor.rgb *= 1.0 - sur * 0.1;
            }
            vec3 glassCol = uWindow * (0.75 + 0.35 * cellId);
            if (fl < 0.5 && uGlass < 0.5) glassCol = mix(glassCol, vec3(0.55, 0.42, 0.28), 0.45 * cellId);
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, fWin * uAmount);
          }
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, fWin * uAmount);`,
      );
  };
  m.customProgramCacheKey = () => `facade-${id}`;
  return m;
}

export const PALETTE = {
  marble: [0xf2ede3, 0xebe3d3, 0xf5f1e8, 0xe6dccb, 0xefe6d6, 0xe9e2d6, 0xf7f3ea, 0xdfd4c1],
  warm: [0xe8d9bd, 0xe3cfae, 0xead7b9, 0xdcc7a6, 0xe9dcc4, 0xd8c3a0, 0xefe2c9, 0xe0cdb0],
  stone: [0xc9bfae, 0xbfb4a2, 0xd1c7b6, 0xb8ad9a, 0xc4b9a6, 0xcfc4b0, 0xbcb09c, 0xd6ccbb],
  rose: [0xc0392b, 0xd35400, 0xe25b45, 0xb03a2e, 0xe67e5a, 0xc0503a, 0xa93226, 0xd9644b],
};

export function pick(arr: readonly number[], i: number): number {
  return arr[((i % arr.length) + arr.length) % arr.length]!;
}

export interface CityMaterials {
  palazzo: THREE.MeshStandardMaterial;
  quartieri: THREE.MeshStandardMaterial;
  tower: THREE.MeshStandardMaterial;
  podium: THREE.MeshStandardMaterial;
  warehouse: THREE.MeshStandardMaterial;
  fortress: THREE.MeshStandardMaterial;
  plain: THREE.MeshStandardMaterial;
  polished: THREE.MeshStandardMaterial;
  hedge: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  cypress: THREE.MeshStandardMaterial;
  blossom: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  terracotta: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  sea: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  spray: THREE.MeshStandardMaterial;
}

export function cityMaterials(): CityMaterials {
  return {
    palazzo: facadeMaterial({ bay: 3.4, floor: 4.2, window: 0x2c3640, amount: 0.92, ground: 1 }),
    quartieri: facadeMaterial({ bay: 2.8, floor: 3.6, window: 0x2a2f36, amount: 0.9, ground: 0.8 }),
    tower: facadeMaterial({ bay: 2.2, floor: 3.8, window: 0x7d95ad, amount: 0.85, ground: 1, glass: true, roughness: 0.35 }),
    podium: facadeMaterial({ bay: 4.0, floor: 4.0, window: 0x3a4652, amount: 0.9, ground: 1 }),
    warehouse: facadeMaterial({ bay: 6.0, floor: 7.0, window: 0x2a3036, amount: 0.75, ground: 1, roughness: 0.8 }),
    fortress: facadeMaterial({ bay: 5.0, floor: 5.5, window: 0x1d2024, amount: 0.55, ground: 0, roughness: 0.85 }),
    plain: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    polished: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32 }),
    hedge: new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.95 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x4e7a3a, roughness: 0.9, flatShading: true }),
    cypress: new THREE.MeshStandardMaterial({ color: 0x2f4f2a, roughness: 0.95, flatShading: true }),
    blossom: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, metalness: 0.4 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x7a5a32, roughness: 0.4, metalness: 0.6 }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3f8f9a, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.88 }),
    sea: new THREE.MeshStandardMaterial({ color: 0x2e6f8e, roughness: 0.12, metalness: 0.3 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd27a, emissiveIntensity: 0.9 }),
    banner: new THREE.MeshStandardMaterial({ color: 0x8e1b1b, roughness: 0.9, side: THREE.DoubleSide }),
    spray: new THREE.MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }),
  };
}

/** Large-format marble paving drawn per cell type, sampled in world space. */
export function pavingTexture(draw: (g: CanvasRenderingContext2D, pxPerM: number) => void, sizeM: number, pxPerM = 9): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(sizeM * pxPerM);
  const g = c.getContext('2d')!;
  draw(g, pxPerM);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
