# tinyflock example assets

## Herring gull flight study

The mesh, packed normal texture, 35-bone rig, and Flap/Glide animation are authored in this repository. Editable source: `assets/gull/gull.blend`. Conventional skinned export: `assets/gull/gull-rigged.glb`. Construction and export code: `assets/gull/build.py`.

The browser's `gull.glb` contains 12 morph poses sampled from the deform rig, allowing independent animation phases with instanced rendering. This is a visual study of a herring gull, not a validated biological model. No third-party bird mesh or photographic textures are included in the current asset. The authored source, mesh, textures, rig and animation use the repository's MIT license.

Anatomy references (not distributed as textures):

- https://waterbirdmonitoring.info/species/68-racek-stribrity/
- https://www.chicagobirder.org/blog/2021/9/23/dans-feathursday-feature-herring-gull-or-if-biologists-write-limericks
- https://www.rspb.org.uk/birds-and-wildlife/herring-gull

## Kloppenheim 06 landscape HDR

- Author: **Greg Zaal**, via **Poly Haven**.
- Source: https://polyhaven.com/a/kloppenheim_06
- License: **CC0 1.0**, https://polyhaven.com/license
- Distributed files: `kloppenheim_landscape_4k.hdr` and `kloppenheim_landscape_2k.hdr`, the original HDR downloads, renamed locally. The 2K file is a capability fallback.
- 4K download: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloppenheim_06_4k.hdr
- 2K download: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_2k.hdr

The landscape photograph supplies the visible countryside and sky plus environment lighting. The runtime extracts the dominant bright sky lobe into a directional light and uses the remainder for ambient lighting; it preserves the visible panorama. Its license is separate from the simulation code and authored gull asset.
