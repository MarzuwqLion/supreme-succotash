# Napoli art direction

Reference for future designs. The images in `docs/reference/` are the target look. The gray-box build already follows the palette, proportions, and layout ideas below. Final art should push further in the same direction.

## The city

| Reference | What it shows |
| --- | --- |
| [Hillside](reference/napoli-hillside.webp) | White marble terraces climbing a hill to a lantern-topped dome. Modern white towers in the distance, cypresses, red-orange rose beds, a reflecting pool, towering cumulus. |
| [Boulevard](reference/napoli-boulevard.webp) | A wide marble-paved street of cream stone palazzi: balconies, storefronts, lamp posts, rose planters, warm late sun. In this Napoli the street has no cars. |
| [Arcades](reference/napoli-arcades.webp) | Monumental white arches and colonnades, red velvet and red domes, pools and gardens, open sky through every opening. |
| [Interior](reference/napoli-interior.webp) | Dark green marble columns, arched mirrors, blue velvet and rust leather. The register for future interiors (bars, salons, the Mansion). |

**Napoli is a modern city that never abandoned classical Roman architecture.**
- **Scale:** big walkable spaces and wide boulevards.
- **Materials:** marble buildings, cream to warm white.
- **Gardens:** roses everywhere, cypress trees, fountains.
- **Height:** colonnaded elevated walkways and bridges, riverwalks along canals, white glass towers among domes.
- **Sky:** there's a strong sense of height, but the open sky always shows.

How the build expresses this:

- **Blocks:** 24 m, open boulevards and piazzas rather than corridors. Quartieri is the one deliberately tight district, with tall narrow lanes.
- **Facades:** a procedural shader draws window bays (arched on alternate storeys), floor bands, pilasters, and tall ground-floor storefronts. Towers get glass bands with white fins.
- **Porticos:** colonnaded on palazzi that face open space. Elevated promenades have an arcade underneath, a balustrade, roses spilling over, and stairs down to the street.
- **Canals:** sunken, with riverwalks on both banks, benches facing the water, and boats.
- **Skyline:** palazzi, red and white domes, and white towers continue past the play space. A hazy volcano sits on the horizon.
- **Palette:** ivory and cream marble, terracotta domes, red-orange roses, dark cypress green, Mediterranean blue sky with big clouds.

## The inhabitants

[Character sheet](reference/napoli-inhabitants.webp): draped modern versions of the toga, palla, and stola.

- **Colours:** ivory and cream, crimson and orange-red, oxblood, and black. Leather and gold appear as accents.
- **Older men:** grey beards, earthy browns, and slate blue.
- **Women:** long gowns with a palla over one shoulder. Some wear gold headbands.
- **Veteran Legionary:** oxblood tunic, leather cuirass, crimson cloak.

How the build expresses this (`src/render/looks.ts`, `src/render/rig.ts`):

| Character | Look |
| --- | --- |
| Civilians | Gowns, tunics, and diagonal drapes over the chest, with the occasional cloak, beard, or headband. Seeded variation from the palette above. |
| Legionaries | Oxblood tunic, leather cuirass, crimson cloak, bronze band. |
| Lucca | Brown robe with a slate-blue drape, grey hair and beard (the old man on the sheet). |
| Lucretia | Orange-red gown, black mantle, gold headband (the woman in black on the sheet). |
| Federation Troopers and escorts | Modern gray tactical gear. They're deliberately foreign to the city's palette. |
| Commander Hale | Federation white and gold, with a long white coat. |
