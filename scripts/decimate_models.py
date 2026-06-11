import bpy
import sys
import os
import math

argv = sys.argv[sys.argv.index("--") + 1:]
input_path = argv[0]
output_path = argv[1]
ratio = float(argv[2]) if len(argv) > 2 else 0.3

bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.gltf(filepath=input_path)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']

if not meshes:
    print(f"No meshes found in {input_path}")
    sys.exit(1)

total_before = 0
total_after = 0

for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)

    verts_before = len(obj.data.vertices)
    total_before += verts_before

    target = int(verts_before * ratio)
    remaining = verts_before
    pass_num = 0
    while remaining > target and pass_num < 5:
        pass_ratio = max(target / remaining, 0.02)
        modifier = obj.modifiers.new(name="Decimate", type='DECIMATE')
        modifier.ratio = pass_ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        remaining = len(obj.data.vertices)
        pass_num += 1

    verts_after = len(obj.data.vertices)
    total_after += verts_after

    print(f"  {obj.name}: {verts_before} -> {verts_after} verts ({verts_after/max(verts_before,1)*100:.1f}%)")

os.makedirs(os.path.dirname(output_path), exist_ok=True)

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
)

print(f"\nSaved: {output_path}")
print(f"Total: {total_before} -> {total_after} verts ({total_after/max(total_before,1)*100:.1f}%)")
