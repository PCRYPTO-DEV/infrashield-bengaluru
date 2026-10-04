# Atlas Infinity visual language

Not a map clone. The city is drawn as ink on paper and certainty is the only
thing that gets colour.

## Ground rules

1. **Paper and ink.** Background `#f3eee3`; geometry in one ink `#2b2a26` at
   graded opacities. Buildings are paper-toned fills with a hairline edge
   and a hatch on the south-east faces when they are tall. Parks carry a
   seeded stipple (a nod to Shan Shui's textures). Roads are a casing and
   a lighter fill, with a dashed centreline on arterials only.
2. **Evidence owns the hues.**
   - observed: ink, solid.
   - derived: teal `#2f7f86`, as soft translucent overlays (flow width by
     count, density discs, anomaly rings dashed).
   - predicted: violet-grey `#6f66a3`, dashed ghost paths with a widening
     translucent envelope and a `+45s · 67%` tag.
   - simulated: plum `#8a5a86`; a badge in the header, and a quiet radial
     vignette when the clock runs ahead of now.
3. **Risk is contour, not marker.** Incidents and risk hotspots are concentric
   rings whose radius scales with severity and whose alpha decays outward;
   a three-second phase animates them without blinking.
4. **Activity is a pulse.** Hotspots emit slow expanding rings; density is a
   warm `#c98a2e` wash, never a heat-map rainbow.
5. **Movement is a trace.** Vehicles are small ink capsules with a paper
   windscreen mark, never smaller than 7 × 3 px; outside Reality mode they
   trail a faint directional trace from their last samples. Pedestrians are
   green-grey dots.
6. **Signals** are two tiny phase dots at the stop lines (green/red/amber).
7. **Typography.** Georgia for everything; small caps with wide tracking for
   labels; monospace only for seeds, clocks and stats.
8. **No gaming HUD.** Panels are translucent paper with hairlines, pinned to
   the edges, and leave the centre of the screen to the city.

## LOD treatment

| tier | what is drawn |
|---|---|
| city (zoom < 14.4) | district tiles: density-tinted sub-tiles; arterials everywhere, collectors only where density ≥ 0.3 so the periphery of the infinite city reads as sparse; district names from zoom 12.8; vehicles as faint 1 px dots; street chunks fade to 25 % |
| neighbourhood (14.4–16) | all roads with casings, block outlines, parks, construction, transit; vehicles as dots |
| street (≥ 16) | buildings with hatch, stipple, labels, signal phases, full agents, incidents, predictions |

A performance budget (20 ms/frame) can demote the tier by up to two levels.
