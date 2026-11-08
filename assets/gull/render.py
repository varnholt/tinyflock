"""Render anatomy/pose review images from the editable source asset."""
from pathlib import Path
import math
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
out=HERE/'previews'
out.mkdir(exist_ok=True)
scene=bpy.context.scene
rig=bpy.data.objects['Gull_Rig']
rig.animation_data.action=bpy.data.actions['Flap']
rig.animation_data.action_slot=bpy.data.actions['Flap'].slots[0]
world=bpy.data.worlds.new('Neutral review environment')
world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.21,.25,.29,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
scene.world=world
for name,position,power,size in [('Key',(1.2,-1.7,2),38,1.4),('Fill',(-.5,1.5,.7),16,1.6),('Rim',(-1,-.3,1.2),24,1)]:
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
    obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj); obj.location=position
    obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Review camera'); camera=bpy.data.objects.new('Review camera',data)
scene.collection.objects.link(camera); scene.camera=camera
data.type='ORTHO'; data.ortho_scale=1.95
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=1100; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
for name,position,frame in [('profile',(0,-2,.18),0),('top',(-.1,-.2,2),0),
    ('three-quarter',(.85,-1.6,.7),12),('upstroke',(.85,-1.6,.7),6),
    ('downstroke',(.85,-1.6,.7),18)]:
    scene.frame_set(frame)
    camera.location=position
    camera.rotation_euler=(Vector((0,0,.03))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(out/(name+'.png'))
    bpy.ops.render.render(write_still=True)
