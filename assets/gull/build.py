"""Build the editable gull, FK flight rig, and instanced delivery GLB.

Blender 5: --factory-startup --background --python assets/gull/build.py
Authoring coordinates: +X forward, +Y left, +Z up; meters.
"""
from pathlib import Path
import math
import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
TAU = math.tau
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

def smooth(a, b, value):
    t = max(0, min(1, (value-a)/(b-a)))
    return t*t*(3-2*t)

# Short feather relief in tangent space; no directional shading baked into albedo.
size = 512
v, u = np.mgrid[0:size, 0:size]/size
rows = v*120
columns = u*65+(np.floor(rows)%2)*.5
ridge = np.exp(-(((rows%1)-(.74-1.6*((columns%1)-.5)**2))/.065)**2)
height = ridge*.7+np.sin(TAU*(u*225+v*153))*.07
dy, dx = np.gradient(height)
normals = np.stack((-dx*3,-dy*3,np.ones_like(dx)),axis=-1)
normals /= np.linalg.norm(normals,axis=-1,keepdims=True)
image = bpy.data.images.new('Plumage microstructure',width=size,height=size,alpha=True)
image.colorspace_settings.name='Non-Color'
image.pixels.foreach_set(np.asarray(np.dstack((normals*.5+.5,np.ones_like(dx))),dtype=np.float32).ravel())
image.pack()

def material(name, roughness, relief=False):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    mat.use_backface_culling=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value=roughness
    if name=='Plumage':
        shader.inputs['Sheen Weight'].default_value=.08
        shader.inputs['Sheen Roughness'].default_value=.8
    color=mat.node_tree.nodes.new('ShaderNodeVertexColor')
    color.layer_name='Tint'
    mat.node_tree.links.new(color.outputs['Color'],shader.inputs['Base Color'])
    if relief:
        texture=mat.node_tree.nodes.new('ShaderNodeTexImage'); texture.image=image
        normal=mat.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value=.10
        mat.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
        mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    return mat

plumage=material('Plumage',.74,True)
bare=material('Bill and tucked feet',.5)
eye=material('Eye',.19)
parts=[]

def mesh_part(name,vertices,faces,colors,uv,weights,mat=plumage):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces); mesh.update(); mesh.materials.append(mat)
    tint=mesh.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='POINT')
    for i,value in enumerate(colors): tint.data[i].color=tuple(value[:3])+(1,)
    coordinates=mesh.uv_layers.new()
    for face in mesh.polygons:
        face.use_smooth=True
        for loop in face.loop_indices:
            coordinates.data[loop].uv=uv[mesh.loops[loop].vertex_index]
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    for i,influences in enumerate(weights):
        for bone,value in influences.items():
            group=obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            group.add([i],value,'REPLACE')
    parts.append(obj)
    return obj

def fixed(bone,count): return [{bone:1.0} for _ in range(count)]

def profile_at(points,x):
    index=next((i for i in range(len(points)-1) if x<=points[i+1][0]),len(points)-2)
    p0,p1=points[max(0,index-1)],points[index]
    p2,p3=points[index+1],points[min(len(points)-1,index+2)]
    t=(x-p1[0])/(p2[0]-p1[0]); result=[]
    for axis in range(1,len(p1)):
        m1=(p2[axis]-p0[axis])/max(1e-6,p2[0]-p0[0])*(p2[0]-p1[0])
        m2=(p3[axis]-p1[axis])/max(1e-6,p3[0]-p1[0])*(p2[0]-p1[0])
        result.append((2*t**3-3*t*t+1)*p1[axis]+(t**3-2*t*t+t)*m1+
                      (-2*t**3+3*t*t)*p2[axis]+(t**3-t*t)*m2)
    return result

def body_weights(x):
    neck=smooth(.09,.19,x); head=smooth(.19,.245,x)
    return {n:w for n,w in {'body':1-neck,'neck':neck*(1-head),'head':neck*head}.items() if w>0}

# Continuous breast, neck and skull: volume is modeled in flight posture.
profile=[(-.24,.010,.012,.016),(-.19,.040,.038,.009),(-.12,.067,.061,.006),
    (-.035,.083,.074,.012),(.055,.077,.079,.019),(.12,.057,.063,.037),
    (.18,.038,.040,.063),(.22,.043,.044,.077),(.255,.039,.039,.080),
    (.285,.027,.024,.067),(.307,.013,.012,.058)]
vertices,faces,colors,uv,weights=[],[],[],[],[]
rings,radial=70,28
for row in range(rings):
    x=profile[0][0]+(profile[-1][0]-profile[0][0])*row/(rings-1)
    width,height,center=profile_at(profile,x)
    for col in range(radial):
        angle=TAU*col/radial
        vertices.append((x,width*math.cos(angle),center+height*math.sin(angle)))
        mantle=smooth(-.18,-.07,x)*(1-smooth(.04,.16,x))*smooth(.25,.8,math.sin(angle))
        colors.append(np.array((.79,.78,.735))*(1-mantle)+np.array((.22,.26,.31))*mantle)
        uv.append((row/(rings-1),col/radial)); weights.append(body_weights(x))
for row in range(rings-1):
    for col in range(radial):
        a=row*radial+col; b=row*radial+(col+1)%radial
        faces.append((a,b,b+radial,a+radial))
faces.extend([tuple(reversed(range(radial))),tuple((rings-1)*radial+i for i in range(radial))])
mesh_part('Continuous breast neck and head',vertices,faces,colors,uv,weights)

def ellipsoid(name,center,scale,tint,bone,mat=plumage,segments=20,rings=12):
    vertices,faces,uv=[],[],[]
    for row in range(rings):
        latitude=-math.pi/2+.005+(math.pi-.01)*row/(rings-1)
        for col in range(segments):
            angle=TAU*col/segments
            vertices.append((center[0]+scale[0]*math.cos(latitude)*math.cos(angle),
                center[1]+scale[1]*math.cos(latitude)*math.sin(angle),center[2]+scale[2]*math.sin(latitude)))
            uv.append((col/segments,row/(rings-1)))
    for row in range(rings-1):
        for col in range(segments):
            a=row*segments+col; b=row*segments+(col+1)%segments
            faces.append((a,b,b+segments,a+segments))
    faces.extend([tuple(reversed(range(segments))),tuple((rings-1)*segments+i for i in range(segments))])
    return mesh_part(name,vertices,faces,[tint]*len(vertices),uv,fixed(bone,len(vertices)),mat)

for upper in [True,False]:
    vertices,faces,uv=[],[],[]
    sections=[(.298,.013,.011,.058),(.32,.012,.010,.057),(.344,.0095,.008,.055),
              (.366,.006,.008,.052),(.382,.001,.002,.045)]
    for row in range(22):
        x=.298+(.382-.298)*row/21; width,height,z=profile_at(sections,x)
        width*=1.15; height*=1.15
        for col in range(12):
            angle=math.pi*col/11
            vertices.append((x,width*math.cos(angle),z+(height*math.sin(angle) if upper else -.002-.005*math.sin(angle))))
            uv.append((row/21,col/11))
    for row in range(21):
        for col in range(11):
            a=row*12+col
            faces.append((a,a+1,a+13,a+12) if upper else (a+12,a+13,a+1,a))
        a=row*12; b=a+11
        faces.append((a,a+12,b+12,b) if upper else (b,b+12,a+12,a))
    faces.extend([tuple(reversed(range(12))),tuple(21*12+i for i in range(12))])
    mesh_part('Upper hooked bill' if upper else 'Lower mandible',vertices,faces,
        [(.65,.43,.065) if upper else (.55,.35,.045)]*len(vertices),uv,fixed('head',len(vertices)),bare)
for side in [-1,1]:
    ellipsoid('Nostril',(.324,side*.011,.060),(.005,.001,.0014),(.065,.047,.025),'head',bare,12,8)
    ellipsoid('Red gonys spot',(.356,side*.0075,.047),(.0055,.001,.0025),(.48,.045,.018),'head',bare,12,8)
    ellipsoid('Pale eyelid',(.256,side*.0368,.087),(.0073,.0028,.0068),(.63,.60,.43),'head',bare)
    ellipsoid('Amber iris',(.2565,side*.0392,.087),(.0051,.0018,.0051),(.49,.38,.12),'head',eye)
    ellipsoid('Black pupil',(.257,side*.0406,.087),(.00235,.0011,.0025),(.005,.006,.005),'head',eye)

stations=[(.052,.055,-.118,.055,.044),(.10,.022,-.160,.060,.035),
    (.18,-.016,-.19,.061,.024),(.24,.016,-.182,.065,.022),(.33,.055,-.165,.063,.018),
    (.40,.035,-.175,.057,.014),(.49,-.018,-.206,.051,.011),(.57,-.095,-.237,.046,.007),
    (.65,-.171,-.226,.039,.004),(.71,-.215,-.222,.034,.0015)]
def wing_at(span):
    a,b,c,d=profile_at(stations,max(.052,min(.71,span)))
    return a,b,c,max(.001,d)

def wing_weights(span,side):
    suffix='L' if side>0 else 'R'
    fore=smooth(.14,.25,span); hand=smooth(.32,.43,span); root=smooth(.05,.105,span)
    return {n:w for n,w in {'body':1-root,f'upper_arm.{suffix}':root*(1-fore),
        f'forearm.{suffix}':root*fore*(1-hand),f'hand.{suffix}':root*fore*hand}.items() if w>0}

def wing_skin(side):
    vertices,faces,colors,uv,weights=[],[],[],[],[]
    rings,radial=38,20
    for row in range(rings):
        span=.052+(.71-.052)*row/(rings-1); leading,trailing,z,thickness=wing_at(span)
        for col in range(radial):
            angle=TAU*col/radial; chord=(1-math.cos(angle))/2
            vertices.append((leading+(trailing-leading)*chord,side*span,
                z+thickness*math.sin(angle)*(.85+.15*math.cos(angle))))
            top=smooth(-.15,.55,math.sin(angle)); tip=smooth(.47,.69,span)
            tint=np.array((.78,.77,.72))*(1-top)+np.array((.18,.22,.27))*top
            colors.append(tint*(1-tip)+np.array((.025,.03,.035))*tip)
            uv.append((chord,row/(rings-1))); weights.append(wing_weights(span,side))
    for row in range(rings-1):
        for col in range(radial):
            a=row*radial+col; b=row*radial+(col+1)%radial
            face=(a,b,b+radial,a+radial)
            faces.append(face if side>0 else tuple(reversed(face)))
    faces.extend([tuple(reversed(range(radial))),tuple((rings-1)*radial+i for i in range(radial))])
    mesh_part(f'Sculpted wing {side}',vertices,faces,colors,uv,weights)

feather_bones=[]
def feather(name,start,tip,width,thickness,tint,bone=None,side=1,primary_index=None,conform=0):
    start,tip=Vector(start),Vector(tip); direction=tip-start
    across=Vector((-direction.y,direction.x,0)).normalized()
    vertices,faces,colors,uv,weights=[],[],[],[],[]
    rings,radial=(10,8) if primary_index is not None else (6,5) if conform else (7,6)
    for row in range(rings):
        t=row/(rings-1)
        breadth=max(.002,math.sin(math.pi*(.035+.955*t))**.55)*width/2
        depth=max(.00025,thickness*(1-.65*t)*math.sin(math.pi*(.08+.85*t))**.45)
        center=start+direction*t; center.z+=min(.002,thickness*.7)*math.sin(math.pi*t)
        for col in range(radial):
            angle=TAU*col/radial
            p=center+across*(math.cos(angle)*breadth); p.z+=math.sin(angle)*depth
            if conform:
                leading,trailing,z,wing_depth=wing_at(abs(p.y))
                chord=max(0,min(1,(p.x-leading)/(trailing-leading)))
                cosine=1-2*chord
                surface=wing_depth*math.sqrt(max(0,1-cosine*cosine))*(.85+.15*cosine)
                p.z=z+conform*(surface+.0008)+math.sin(angle)*depth
            vertices.append(tuple(p))
            top=smooth(-.2,.4,math.sin(angle)); base=np.array(tint)*(.88+.12*top)
            if primary_index is not None:
                black=smooth(.34,.64,t)*smooth(2,6,primary_index)
                base=base*(1-black)+np.array((.018,.022,.028))*black
                if primary_index>=8:
                    mirror=math.exp(-((t-.86)/.07)**4)*.82
                    base=base*(1-mirror)+np.array((.82,.81,.76))*mirror
            colors.append(np.minimum(1,base+abs(math.cos(angle))**12*.035))
            uv.append(((1+math.cos(angle))/2,t))
            weights.append({bone:1.0} if bone else wing_weights(abs(p.y),side))
    for row in range(rings-1):
        for col in range(radial):
            a=row*radial+col; b=row*radial+(col+1)%radial
            faces.append((a,b,b+radial,a+radial))
    faces.extend([tuple(reversed(range(radial))),tuple((rings-1)*radial+i for i in range(radial))])
    return mesh_part(name,vertices,faces,colors,uv,weights)

for side in [-1,1]:
    suffix='L' if side>0 else 'R'; wing_skin(side)
    for i in range(11):
        span=.105+i*.026; leading,trailing,z,thickness=wing_at(span)
        feather(f'Secondary {i+1:02}.{suffix}',(leading-.055,side*span,z),
            (trailing-.035,side*(span+.018),z-.007),.045,.0014,(.26,.29,.32),side=side)
    for i in range(10):
        t=i/9; span=.355+t*.19; leading,trailing,z,thickness=wing_at(span)
        start=(leading-.035,side*span,z); tip=(-.265+.045*t,side*(.415+.335*t),.030-.006*t)
        name=f'primary_{i+1:02}.{suffix}'
        feather_bones.append((name,start,tip,f'hand.{suffix}'))
        feather(f'Primary {i+1:02}.{suffix}',start,tip,.042-t*.008,.0016,(.24,.27,.30),
                bone=name,side=side,primary_index=i)
    for layer in [-1,1]:
        for row in range(4 if layer>0 else 3):
            for i in range(24):
                span=.075+i*.018; leading,trailing,z,thickness=wing_at(span)
                chord=.16+row*.18; x=leading+(trailing-leading)*chord
                height=z+layer*(thickness*math.sin(math.pi*chord)+.0007)
                feather(f'Covert {layer} {row} {i}.{suffix}',(x,side*span,height),
                    (x-.048,side*(span+.004),height-layer*.0005),.024,.00035,
                    (.20,.24,.28) if layer>0 else (.77,.76,.71),side=side,conform=layer)
for i in range(12):
    t=(i-5.5)/5.5
    feather(f'Tail rectrix {i+1:02}',(-.18,t*.015,.020),(-.37+abs(t)*.016,t*.064,.010),
            .022,.0023,(.78,.77,.73),'tail')

def capsule(name,a,b,radius,tint,bone):
    a,b=Vector(a),Vector(b)
    obj=ellipsoid(name,(0,0,0),(radius,radius,(b-a).length/2+radius),tint,bone,bare,12,8)
    rotation=(b-a).to_track_quat('Z','Y').to_matrix()
    for vertex in obj.data.vertices: vertex.co=rotation@vertex.co+(a+b)/2
for side in [-1,1]:
    suffix='L' if side>0 else 'R'
    hip=(-.075,side*.035,-.035); ankle=(-.14,side*.034,-.065); foot=(-.21,side*.034,-.054)
    capsule('Tucked hock',hip,ankle,.005,(.42,.26,.22),f'leg.{suffix}')
    capsule('Tucked foot',ankle,foot,.004,(.43,.27,.23),f'foot.{suffix}')
    for toe in range(3):
        capsule('Folded toe',foot,(-.25,side*.034+(toe-1)*.013,-.052),.0022,(.42,.25,.22),f'foot.{suffix}')

# Compact flight neck. The monotone x adjustment affects the skull and bill
# together, and is applied to the rest skeleton as well as the surface.
def compact(p):
    p=Vector(p)
    p.x-=.025*smooth(.10,.23,p.x)
    return p
for obj in parts:
    for vertex in obj.data.vertices: vertex.co=compact(vertex.co)

# Deform skeleton: separately adjustable primaries and an actual FK arm chain.
armature=bpy.data.armatures.new('Gull flight skeleton')
rig=bpy.data.objects.new('Gull_Rig',armature); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
    result=armature.edit_bones.new(name); result.head=compact(head); result.tail=compact(tail)
    if parent: result.parent=armature.edit_bones[parent]
    if abs((Vector(tail)-Vector(head)).normalized().z)<.99: result.align_roll(Vector((0,0,1)))
    return result
bone('root',(0,0,-.12),(0,0,-.02))
bone('body',(-.16,0,.015),(.1,0,.035),'root')
bone('neck',(.1,0,.035),(.21,0,.075),'body')
bone('head',(.21,0,.075),(.31,0,.06),'neck')
bone('tail',(-.16,0,.015),(-.34,0,.01),'body')
for side in [-1,1]:
    suffix='L' if side>0 else 'R'
    bone(f'upper_arm.{suffix}',(.025,side*.055,.055),(-.035,side*.20,.061),'body')
    bone(f'forearm.{suffix}',(-.035,side*.20,.061),(.04,side*.39,.057),f'upper_arm.{suffix}')
    bone(f'hand.{suffix}',(.04,side*.39,.057),(-.09,side*.56,.045),f'forearm.{suffix}')
    bone(f'leg.{suffix}',(-.075,side*.035,-.035),(-.14,side*.034,-.065),'body')
    bone(f'foot.{suffix}',(-.14,side*.034,-.065),(-.23,side*.034,-.052),f'leg.{suffix}')
for name,start,tip,parent in feather_bones: bone(name,start,tip,parent)
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True; armature.display_type='OCTAHEDRAL'
for name in ['Body and head','Wings','Primaries','Feet']: armature.collections.new(name)
for b in armature.bones:
    category='Primaries' if b.name.startswith('primary') else 'Wings' if any(s in b.name for s in ['upper_arm','forearm','hand']) else 'Feet' if any(s in b.name for s in ['leg.','foot.']) else 'Body and head'
    armature.collections[category].assign(b)
    b.color.palette='THEME04' if category=='Wings' else 'THEME03' if category=='Primaries' else 'THEME02'
bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join()
gull=bpy.context.object; gull.name='Gull'; gull.parent=rig
modifier=gull.modifiers.new('Flight skin','ARMATURE'); modifier.object=rig
modifier.use_deform_preserve_volume=False  # same linear skinning as glTF
gull.data.color_attributes.active_color_index=0; gull.data.color_attributes.render_color_index=0
bpy.context.view_layer.objects.active=gull
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')

scene=bpy.context.scene; scene.render.fps=30; scene.frame_start=0; scene.frame_end=24
for name in ['Flap','Glide']:
    rig.animation_data_create(); rig.animation_data.action=None
    for frame in range(25):
        phase=TAU*frame/24; stroke=math.sin(phase)
        for pb in rig.pose.bones:
            pb.rotation_mode='XYZ'; pb.rotation_euler=(0,0,0); pb.location=(0,0,0)
        for side in [-1,1]:
            suffix='L' if side>0 else 'R'
            if name=='Flap':
                recovery=max(0,math.cos(phase))
                rig.pose.bones[f'upper_arm.{suffix}'].rotation_euler.x=math.radians(43*stroke+5)
                rig.pose.bones[f'forearm.{suffix}'].rotation_euler.x=math.radians(-12*math.sin(phase-.35))
                rig.pose.bones[f'forearm.{suffix}'].rotation_euler.z=side*math.radians(19*recovery)
                rig.pose.bones[f'hand.{suffix}'].rotation_euler.y=side*math.radians(16*recovery-6*(1-recovery))
                rig.pose.bones[f'hand.{suffix}'].rotation_euler.x=math.radians(8*math.sin(phase-.65))
                for i in range(10):
                    pb=rig.pose.bones[f'primary_{i+1:02}.{suffix}']
                    pb.rotation_euler.y=side*math.radians((2+i*.35)*recovery)
                    pb.rotation_euler.z=side*math.radians((i-4.5)*.45*recovery)
            else:
                rig.pose.bones[f'upper_arm.{suffix}'].rotation_euler.x=math.radians(5+1.2*math.sin(phase))
                rig.pose.bones[f'hand.{suffix}'].rotation_euler.y=side*math.radians(-3)
        rig.pose.bones['tail'].rotation_euler.x=math.radians(1.5*math.sin(phase-.3))
        rig.pose.bones['head'].rotation_euler.x=math.radians(.8*math.sin(phase+.8))
        for pb in rig.pose.bones: pb.keyframe_insert(data_path='rotation_euler',frame=frame,group=pb.name)
    action=rig.animation_data.action; action.name=name; action.use_fake_user=True
rig.animation_data.action=bpy.data.actions['Glide']; rig.animation_data.action_slot=bpy.data.actions['Glide'].slots[0]
scene.frame_set(0)
rig['controls']='FK upper_arm -> forearm -> hand -> primary_01..10, on both sides; neck/head/tail/feet'
gull['species_reference']='European herring gull, flight study'
gull['units']='meters; authoring +X forward, +Z up'
armature.collections['Primaries'].is_visible=False
armature.collections['Feet'].is_visible=False
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.region_3d.view_distance=1.8
            area.spaces.active.region_3d.view_location=(0,0,.025)
            area.spaces.active.region_3d.view_rotation=Vector((.8,-1.7,.7)).to_track_quat('Z','Y')
bpy.context.view_layer.objects.active=rig; bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); gull.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'gull.blend'))

# Conventional skinned glTF for users of other renderers/engines.
rotation=Matrix.Rotation(-math.pi/2,4,'Z'); rig.matrix_world=rotation
bpy.ops.export_scene.gltf(filepath=str(HERE/'gull-rigged.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_yup=True,export_extras=True,
    export_vertex_color='NAME',export_vertex_color_name='Tint',export_all_vertex_colors=False)

# Sample the actual deform rig into morph targets for efficient instancing.
rig.matrix_world=Matrix.Identity(4)
def evaluated_mesh(frame):
    scene.frame_set(int(frame),subframe=frame-int(frame)); bpy.context.view_layer.update()
    return bpy.data.meshes.new_from_object(gull.evaluated_get(bpy.context.evaluated_depsgraph_get()))
rig.animation_data.action=bpy.data.actions['Glide']; rig.animation_data.action_slot=bpy.data.actions['Glide'].slots[0]
base=evaluated_mesh(0); baked=bpy.data.objects.new('Gull_Baked',base); bpy.context.collection.objects.link(baked)
gull.name='Gull_Skinned'; baked.name='Gull'; baked.shape_key_add(name='Glide')
rig.animation_data.action=bpy.data.actions['Flap']; rig.animation_data.action_slot=bpy.data.actions['Flap'].slots[0]
samples=12
for i in range(samples):
    sampled=evaluated_mesh(i*24/samples); assert len(sampled.vertices)==len(base.vertices)
    key=baked.shape_key_add(name=f'Flap_{i:02}')
    for dst,src in zip(key.data,sampled.vertices): dst.co=src.co
    bpy.data.meshes.remove(sampled)
for frame in range(25):
    phase=(frame/24*samples)%samples; first=int(phase); blend=phase-first
    for i in range(samples):
        key=baked.data.shape_keys.key_blocks[i+1]
        key.value=(1-blend if i==first else 0)+(blend if i==(first+1)%samples else 0)
        key.keyframe_insert(data_path='value',frame=frame)
baked.data.shape_keys.animation_data.action.name='Flight'
for key in baked.data.shape_keys.key_blocks:
    for vertex in key.data: vertex.co=rotation@vertex.co
bpy.ops.object.select_all(action='DESELECT'); baked.select_set(True); bpy.context.view_layer.objects.active=baked
scene.frame_set(0)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'web/public/assets/gull.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_morph=True,export_morph_normal=True,
    export_yup=True,export_vertex_color='NAME',export_vertex_color_name='Tint',export_all_vertex_colors=False)
print('GULL_ASSET',len(armature.bones),'bones',len(base.vertices),'vertices',
      sum(len(p.vertices)-2 for p in base.polygons),'triangles',samples,'baked poses')
