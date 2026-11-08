# Herring gull flight study

Editable source asset for the tinyflock example. The body is built in flight posture, with a continuous breast/neck/skull, closed cambered wings, individually modelled solid feathers, a hooked bill, eyes, and tucked feet. This is an authored visual study, not a validated anatomical or aerodynamic model.

## Files

- `gull.blend`: editable Blender 5 source, packed normal texture, weighted mesh, 35-bone FK armature, and `Flap` / `Glide` actions.
- `gull-rigged.glb`: conventional skinned glTF with the skeleton and both animation clips, for other engines and renderers.
- `build.py`: deterministic mesh/material/rig construction and export pipeline. Requires Blender's bundled Python and NumPy; no additional add-ons or downloaded bird model.
- `render.py`: neutral-light review renders of the profile, planform, and flap extremes.
- `check.py`: checks closed geometry, skin weights, bone references, finite deformation, symmetric wing motion, seamless animation loops, and the exported skeleton/clips.
- `previews/`: review images rendered from the saved rig.
- `../../web/public/assets/gull.glb`: the browser delivery asset, with 12 sampled poses baked from the actual armature into a glTF `Flight` morph animation. It shares geometry and textures across the flock while allowing independent phases.

## Rig controls

The named `Gull_Rig` armature has four bone collections:

| Collection | Controls |
| --- | --- |
| Body and head | `root`, `body`, `neck`, `head`, `tail` |
| Wings | `upper_arm.L/R`, `forearm.L/R`, `hand.L/R` |
| Primaries | `primary_01.L/R` through `primary_10.L/R` |
| Feet | `leg.L/R`, `foot.L/R` |

Select the armature and enter Pose Mode to edit the FK chain. The Primaries and Feet collections are initially hidden to keep the viewport readable; reveal them in Armature Data Properties. Hidden collections still deform and export normally. The Action Editor contains `Flap` and `Glide`. Both loop over frames 0–24 at 30 fps (0.8 seconds).

The upper arm drives the stroke; the forearm folds during recovery; the wrist changes pitch; primaries twist and fan slightly. Head and tail motion are restrained. Skin blending joins the shoulder to the body and transitions through the elbow and wrist. The flap animation has deliberately slower, independent gliding windows added by the browser renderer rather than baked pauses in the loop.

Authoring axes are **+X forward / +Z up**, in meters. glTF exports are normalized to **+Z forward / +Y up**. Approximate resting dimensions are 1.5 m wingspan and 0.73 m bill-to-tail length. Textures are packed; exported materials use standard PBR, vertex color, and a normal map.

## Rebuild and verify

From the repository root, with Blender on PATH:

```sh
blender --factory-startup --background --disable-autoexec --python assets/gull/build.py
blender --factory-startup --background --disable-autoexec assets/gull/gull.blend --python assets/gull/check.py
blender --factory-startup --background --disable-autoexec assets/gull/gull.blend --python assets/gull/render.py
```

`build.py` regenerates the authored source and exports. To retain hand edits made in Blender, work on a copy; rebuilding replaces `gull.blend`. The compatibility command `scripts/prepare-gull.py` runs the same pipeline.

## Reference and licensing

The mesh, rig, texture and animation are authored in this repository and distributed under the root MIT license. They do not contain meshes or textures from the previous prototype.

Photographic anatomy references (viewed as reference, not included in the asset or used as textures):

- https://waterbirdmonitoring.info/species/68-racek-stribrity/
- https://www.chicagobirder.org/blog/2021/9/23/dans-feathursday-feature-herring-gull-or-if-biologists-write-limericks
- https://www.rspb.org.uk/birds-and-wildlife/herring-gull

The landscape HDR has separate CC0 terms documented in `web/public/assets/CREDITS.md`.
