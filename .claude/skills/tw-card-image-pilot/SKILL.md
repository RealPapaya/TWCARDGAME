---
name: tw-card-image-pilot
description: Create or update a single TWCARDGAME card image pilot from one reference image. Use when the user asks to transform one card asset into a medieval fantasy adventure game character portrait, preserve the reference character exactly, output WebP, enforce 16:9, keep a flat plain background, compress under 50KB, and overwrite only the specified card image before any batch work.
---

# TW Card Image Pilot

Use this skill for a one-card image pilot before any batch image generation.

## Category Background Colors

Use the target card category to choose the final flat background color.

| Category | Background |
| --- | --- |
| 民進黨政治人物 | `#5ab1a1` |
| 國民黨政治人物 | `#194a7a` |
| 民眾黨政治人物 | `#fdfcfb` |
| 勞工 | `#6e4c2d` |
| 建築 | `#ced3d7` |
| 公眾人物 | `#ffb3c6` |
| 學生 | `#ffb352` |
| 動物 | `#f1ddbf` |
| 新聞 | `#28282b` |
| 企業家 | `#8c7aa4` |
| 公務人員 | `#e8d453` |

If the target category is unknown or not listed, ask for the category/color before generation.

## Hard Background Rule

The final image background must be a flat, uniform, solid fill using the target card category color.

- No gradients.
- No texture.
- No scenery.
- No objects.
- No decorations.
- No lighting variation, vignette, shadow, floor plane, or environmental backdrop.

If generation produces a non-flat background, post-process the connected background area to the target category color before saving the final WebP.

## Inputs

- Target card image path, usually `apps/web/public/images/cards/<name>.webp`.
- The target image is the sole reference image and the only file to overwrite.
- Optional card id/name, for reporting only.

If no target path is provided, ask for it. Do not infer a different card asset.

## Core Workflow

1. Inspect the current target file and `git status --short`.
2. Load or view the target image before generation so it is available as the sole visual reference.
3. Generate exactly one pilot image using the prompt template below.
4. Convert/post-process the generated image to WebP:
   - exact `16:9`
   - flat solid target category background color unless the user explicitly provides a different flat color
   - no gradient, texture, scenery, objects, decorations, lighting variation, vignette, shadow, floor plane, or environmental backdrop in the background
   - final file size `<= 50KB`
5. Visually inspect the candidate before replacement.
6. Overwrite only the target card image.
7. Validate:
   - final file type is WebP
   - final aspect ratio is 16:9
   - final file size is under 50KB
   - `git status --short` shows only the intended image changed, plus any explicitly requested skill/config files if the task is creating this skill

## Prompt Template

Use the reference image as the sole source for character appearance, clothing, accessories, pose, expression, hairstyle, age, gender and held objects.

Preserve all visual characteristics from the reference image.

Transform the reference image into a medieval adventure cartoon illustration.

File type needs to be WebP.

Art Style:
medieval fantasy adventure game,
stylized hand-painted character illustration,
high-quality game artwork,
simple readable shapes,
strong silhouette,
medium-detail rendering,
clean visual hierarchy,
professional character design.

Face Rendering:
high facial likeness,
recognizable facial features,
preserve facial identity,
preserve expression from reference image.

Painting Style:
soft painterly shading,
visible brushwork,
smooth color transitions,
warm lighting,
hand-painted fantasy illustration.

Shape Language:
slightly simplified forms,
reduced micro-details,
large readable shapes,
clean edges.

Linework:
minimal outlines,
no comic ink lines,
no sketch effect.

Color Treatment:
natural colors,
slightly warm palette,
balanced saturation,
soft contrast.

Quality:
AAA mobile game character portrait,
high resolution,
production-ready artwork.

Do not redesign the character.
Do not change clothing.
Do not change accessories.
Do not change pose.
Do not change expression.
Do not change held objects.

Only transform the visual style.

Picture size: 16:9.

Background:
flat solid target category background color only,
one uniform color across the entire background,
no gradients,
no texture,
no scenery,
no objects,
no decorations,
no lighting variation,
no vignette,
no shadow,
no floor plane,
no environmental backdrop.

No text, no logos, no watermark.

## Post-Processing Script

Use `scripts/convert-card-image.mjs` when a generated PNG/JPEG needs deterministic conversion.

Example:

```powershell
node .\.claude\skills\tw-card-image-pilot\scripts\convert-card-image.mjs `
  "C:\Users\Morris\.codex\generated_images\<run>\<image>.png" `
  .\tmp\candidate.webp `
  "#194a7a"
```

The script uses local Microsoft Edge headless canvas APIs to:

- center-crop to `1024x576`
- flatten the connected background area to the provided target color
- encode WebP under `50KB` when possible

If browser launch is blocked by sandboxing, request approval to run the script. Do not download image tooling unless the user asks for it.

## Reporting

Report the final path, exact prompt family used, file type, dimensions, final byte size, and `git status --short` result. Mention if any manual post-processing was used.
