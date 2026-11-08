"""Check the saved rig, its skin, volume, symmetry, and looping actions."""
import json
from pathlib import Path
import bpy
import bmesh
import numpy as np

rig=bpy.data.objects['Gull_Rig']
gull=bpy.data.objects['Gull']
assert len(rig.data.bones)==35
assert {'Flap','Glide'} <= set(bpy.data.actions.keys())
names={group.index:group.name for group in gull.vertex_groups}
for vertex in gull.data.vertices:
    assert abs(sum(group.weight for group in vertex.groups)-1)<1e-5
    assert all(names[group.group] in rig.data.bones for group in vertex.groups)
bm=bmesh.new(); bm.from_mesh(gull.data)
assert sum(not edge.is_manifold for edge in bm.edges)==0, 'All feather/body components must be closed'
assert bm.calc_volume()>0, 'The model must have actual volume'
bm.free()
rest=np.array([tuple(v.co) for v in gull.data.vertices])
def sample(frame):
    bpy.context.scene.frame_set(frame)
    evaluated=gull.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=evaluated.to_mesh()
    values=np.array([tuple(v.co) for v in mesh.vertices])
    assert np.isfinite(values).all()
    evaluated.to_mesh_clear()
    return values
report={}
for action_name in ['Flap','Glide']:
    action=bpy.data.actions[action_name]
    rig.animation_data.action=action
    rig.animation_data.action_slot=action.slots[0]
    start=sample(0); end=sample(24)
    assert np.max(np.abs(start-end))<1e-5, f'{action_name} must loop without a position jump'
    tip_heights=[]
    for frame in [0,6,12,18,24]:
        values=sample(frame)
        left=values[rest[:,1]>.42,2]
        right=values[rest[:,1]<-.42,2]
        assert abs(left.max()-right.max())<.012, 'Left/right wing poses must remain symmetric'
        tip_heights.append(float(max(left.max(),right.max())))
    report[action_name]={'tip_heights_m':tip_heights}
assert max(report['Flap']['tip_heights_m'])-min(report['Flap']['tip_heights_m'])>.3
def glb(path):
    data=path.read_bytes()
    assert data[:4]==b'glTF'
    return json.loads(data[20:20+int.from_bytes(data[12:16],'little')])
here=Path(__file__).resolve().parent
skinned=glb(here/'gull-rigged.glb')
assert len(skinned['skins'][0]['joints'])==35
assert {'Flap','Glide'} <= {a['name'] for a in skinned['animations']}
runtime=glb(here.parents[1]/'web/public/assets/gull.glb')
assert any(a['name']=='Flight' for a in runtime['animations'])
assert all(len(p['targets'])==12 for p in runtime['meshes'][0]['primitives'])
print('GULL_CHECKS_PASSED',json.dumps(report))
