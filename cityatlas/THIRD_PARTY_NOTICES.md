# Third-party notices

Atlas Infinity is an original code base. It was designed after studying, and
preserves the conceptual architecture of, the following MIT-licensed works.
No landscape code from either is included; the ideas credited in
`docs/SHAN_SHUI_ARCHITECTURE.md` are.

## {Shan, Shui}* — https://github.com/LingDong-/shan-shui-inf

MIT License

Copyright (c) 2018 Lingdong Huang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## shan_shui (TypeScript/React rewrite) — https://github.com/Megaemce/shan_shui

MIT License — Copyright (c) 2018 Lingdong Huang (as retained by the rewrite);
rewrite by Megaemce. Same terms as above.

## Algorithms referenced (no code copied)

- **Improved Perlin noise** (Ken Perlin, 2002). Public-domain reference
  algorithm; `src/engine/procedural/noise.ts` is an independent
  implementation with a seeded permutation table. The p5.js noise port used
  by Shan Shui (LGPL-2.1) is deliberately not used.
- **Intelligent Driver Model** (Treiber, Hennecke & Helbing, 2000) for
  car-following in `src/engine/simulation/movementEngine.ts`.
- **SORT** (Bewley et al., 2016) as the pattern for the IoU tracker in
  `src/cv/tracker.ts`; the implementation is independent and dependency-free.
- **mulberry32** PRNG (Tommy Ettinger, public domain) and **FNV-1a** hashing.

## Runtime dependencies

React and ReactDOM (MIT, Meta Platforms). Development: Vite, Vitest,
TypeScript, `@vitejs/plugin-react`, `@types/react*` (MIT / Apache-2.0).
