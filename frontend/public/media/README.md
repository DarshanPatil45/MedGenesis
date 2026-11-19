# Image slots

**To add or change an image: drop a file here with the exact filename below.
No code changes.** Delete a file and the UI closes over the gap — it never
shows a broken frame.

| Filename | Where it appears | Status |
|---|---|---|
| `intake-context.jpg` | Patient Intake — wide context band (21:6) | ✅ live |
| `nutrition.jpg` | Care Plan — Nutrition domain (16:7) | ✅ live |
| `activity.jpg` | Care Plan — Activity domain (16:7) | ✅ live |
| `monitoring.jpg` | Care Plan — Monitoring domain (16:7) | ✅ live |

> The three domain images are all-or-nothing: the strip appears only once all
> three exist. Remove any one and the row reverts to text — one photo beside
> two empty frames reads as a broken layout.

The domain strip renders with `tone="muted"` (saturation 0.42 plus a teal/blue
tint). Photos from three different sources clash on hue and saturation; the
muted tone pulls them to a common temperature so the row reads as one design
decision. **Swap any domain photo and it inherits that treatment automatically
— no need to colour-match before uploading.**

Slots are defined in `src/design-system/visuals/media.ts`. Add a new entry
there only for a *new* position; changing an existing picture is just a file.

## Before you drop a file in

```bash
# Resize — anything wider than 1600px is wasted bytes
sips -Z 1600 yourphoto.jpg --out frontend/public/media/activity.jpg
```

Everything in this folder is served publicly at `/media/<filename>`.

**Choose cool or neutral-toned photos.** The UI is teal `#0B6E63` / blue
`#1349B8` on white; amber is the reserved *clinician review* colour, so strongly
warm photos can read as a status signal. Each image gets a light desaturation
and a palette tint automatically, which absorbs a moderate warm cast.

**Avoid medication imagery outside the Monitoring slot** — insulin pens,
syringes, pill packs. The safety layer blocks medication advice, so that
imagery advertises a capability the product deliberately refuses. This is why
Care Plan has no wide context band: it is the recommendation output, and a
medication photo at the top of it actively misleads.

## Alt text

Alt text lives beside the slot in `media.ts`, not at the call site — so a
swapped photo can't inherit a description of the picture it replaced. **If you
change what a picture shows, update its `alt` there.** All nine routes score
Lighthouse accessibility 100; a stale description is the easiest way to lose it.

## Provenance

| File | Shows | Source | Licence |
|---|---|---|---|
| `intake-context.jpg` | Fingertip lancing + glucose meter | Supplied by project owner | ⚠️ **unconfirmed** |
| `monitoring.jpg` | Glucose meter, insulin pen, pill pack | Supplied by project owner | ⚠️ **unconfirmed** |
| `nutrition.jpg` | Green produce + green juice | Supplied by project owner | ⚠️ **unconfirmed** |
| `activity.jpg` | Treadmills and rowers in a daylit gym | Supplied by project owner | ⚠️ **unconfirmed** |

⚠️ **All four licences are unverified.** If any came from a stock library or a
web search, confirm the terms before this is deployed or made public. Record
the source and licence for anything you add.

`hero-kidney-CipfoPK3.png` was removed from this folder — it is
medgenixindia.com's hero asset (the filename carries their Vite build hash).
It is kept at `_unused-assets/` with an explanation. Not deleted, not served.
