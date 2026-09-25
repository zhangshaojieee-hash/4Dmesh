"""Test script: generate multi-object 3MF and slice with PrusaSlicer."""
import os
import sys
import zipfile
import subprocess
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))


def make_box_xml(obj_id, name, x_off, y_off, size=10.0):
    """Generate a simple box object XML at given XY offset, sitting on Z=0."""
    s = size / 2.0
    verts = [
        (x_off - s, y_off - s, 0), (x_off + s, y_off - s, 0),
        (x_off + s, y_off + s, 0), (x_off - s, y_off + s, 0),
        (x_off - s, y_off - s, size), (x_off + s, y_off - s, size),
        (x_off + s, y_off + s, size), (x_off - s, y_off + s, size),
    ]
    tris = [
        (0,1,2),(0,2,3),  # bottom
        (4,6,5),(4,7,6),  # top
        (0,5,1),(0,4,5),  # front
        (2,7,3),(2,6,7),  # back
        (0,3,7),(0,7,4),  # left
        (1,5,6),(1,6,2),  # right
    ]
    vert_xml = "\n".join(f'          <vertex x="{v[0]:.6f}" y="{v[1]:.6f}" z="{v[2]:.6f}" />' for v in verts)
    tri_xml = "\n".join(f'          <triangle v1="{t[0]}" v2="{t[1]}" v3="{t[2]}" />' for t in tris)
    return (
        f'    <object id="{obj_id}" name="{name}" type="model">\n'
        f'      <mesh>\n'
        f'        <vertices>\n{vert_xml}\n        </vertices>\n'
        f'        <triangles>\n{tri_xml}\n        </triangles>\n'
        f'      </mesh>\n'
        f'    </object>'
    )


def write_3mf(path, objects_xml, build_items_xml):
    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
        '  <resources>\n'
        + objects_xml + '\n'
        '  </resources>\n'
        '  <build>\n'
        + build_items_xml + '\n'
        '  </build>\n'
        '</model>'
    )
    rels_xml = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>'''
    content_types_xml = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>'''
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content_types_xml)
        zf.writestr('_rels/.rels', rels_xml)
        zf.writestr('3D/3dmodel.model', model_xml)
    print(f"Wrote: {path}")
    print(f"Model XML length: {len(model_xml)}")


def slice_3mf(path_3mf, output_gcode):
    prusaslicer = r"F:\PrusaSlicer\PrusaSlicer\prusa-slicer-console.EXE"
    configs_dir = os.path.join(os.path.dirname(__file__), '..', 'backend', 'configs')
    cmd = [
        prusaslicer,
        "-g",
        "--load", os.path.join(configs_dir, "bambu_x1c.ini"),
        "--load", os.path.join(configs_dir, "quality_0.20mm.ini"),
        "--gcode-label-objects", "octoprint",
        "--dont-arrange",
        "--center", "110,110",
        "-o", output_gcode,
        path_3mf,
    ]
    print(f"\nCommand: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    print(f"Return code: {result.returncode}")
    if result.stdout:
        print(f"stdout: {result.stdout[:500]}")
    if result.stderr:
        print(f"stderr: {result.stderr[:500]}")
    return result.returncode


def test_single_object():
    print("=" * 60)
    print("TEST 1: Single object 3MF")
    print("=" * 60)
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "single.3mf")
        obj_xml = make_box_xml(1, "box_strong", 0, 0, 10)
        build_xml = '    <item objectid="1" />'
        write_3mf(path, obj_xml, build_xml)
        gcode = os.path.join(td, "single.gcode")
        rc = slice_3mf(path, gcode)
        if rc == 0 and os.path.exists(gcode):
            size = os.path.getsize(gcode)
            print(f"SUCCESS: G-code generated ({size} bytes)")
        else:
            print(f"FAILED: return code {rc}")


def test_multi_object_both_on_bed():
    print("\n" + "=" * 60)
    print("TEST 2: Two objects, both on bed")
    print("=" * 60)
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "multi.3mf")
        obj1 = make_box_xml(1, "box_strong", -15, 0, 10)
        obj2 = make_box_xml(2, "box_weak", 15, 0, 10)
        build_xml = '    <item objectid="1" />\n    <item objectid="2" />'
        write_3mf(path, obj1 + "\n" + obj2, build_xml)
        gcode = os.path.join(td, "multi.gcode")
        rc = slice_3mf(path, gcode)
        if rc == 0 and os.path.exists(gcode):
            size = os.path.getsize(gcode)
            print(f"SUCCESS: G-code generated ({size} bytes)")
            with open(gcode, 'r') as f:
                content = f.read()
            labels = [l for l in content.split('\n') if 'printing object' in l.lower()]
            print(f"Object labels found: {len(labels)}")
            for l in labels[:10]:
                print(f"  {l}")
        else:
            print(f"FAILED: return code {rc}")


def test_multi_object_one_floating():
    print("\n" + "=" * 60)
    print("TEST 3: Two objects, one floating (no pillar)")
    print("=" * 60)
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "floating.3mf")
        obj1 = make_box_xml(1, "box_strong", -15, 0, 10)
        # Floating box: Z starts at 20mm
        s = 5.0
        verts = [
            (15-s, -s, 20), (15+s, -s, 20), (15+s, s, 20), (15-s, s, 20),
            (15-s, -s, 30), (15+s, -s, 30), (15+s, s, 30), (15-s, s, 30),
        ]
        tris = [(0,1,2),(0,2,3),(4,6,5),(4,7,6),(0,5,1),(0,4,5),(2,7,3),(2,6,7),(0,3,7),(0,7,4),(1,5,6),(1,6,2)]
        vert_xml = "\n".join(f'          <vertex x="{v[0]:.6f}" y="{v[1]:.6f}" z="{v[2]:.6f}" />' for v in verts)
        tri_xml = "\n".join(f'          <triangle v1="{t[0]}" v2="{t[1]}" v3="{t[2]}" />' for t in tris)
        obj2 = (
            f'    <object id="2" name="box_weak" type="model">\n'
            f'      <mesh>\n'
            f'        <vertices>\n{vert_xml}\n        </vertices>\n'
            f'        <triangles>\n{tri_xml}\n        </triangles>\n'
            f'      </mesh>\n'
            f'    </object>'
        )
        build_xml = '    <item objectid="1" />\n    <item objectid="2" />'
        write_3mf(path, obj1 + "\n" + obj2, build_xml)
        gcode = os.path.join(td, "floating.gcode")
        rc = slice_3mf(path, gcode)
        if rc == 0 and os.path.exists(gcode):
            size = os.path.getsize(gcode)
            print(f"SUCCESS: G-code generated ({size} bytes)")
        else:
            print(f"FAILED: return code {rc}")


def test_multi_object_with_pillar():
    print("\n" + "=" * 60)
    print("TEST 4: Two objects, floating one has trimesh pillar")
    print("=" * 60)
    try:
        import trimesh
        import numpy as np
    except ImportError:
        print("SKIP: trimesh not installed")
        return

    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "pillar.3mf")
        obj1 = make_box_xml(1, "box_strong", -15, 0, 10)

        # Floating box + pillar merged via trimesh
        floating = trimesh.creation.box(extents=[10, 10, 10])
        floating.apply_translation([15, 0, 25])  # Z: 20-30
        pillar = trimesh.creation.box(extents=[0.4, 0.4, 20])
        pillar.apply_translation([15, 0, 10])  # Z: 0-20
        merged = trimesh.util.concatenate([floating, pillar])

        verts = merged.vertices
        faces = merged.faces
        vert_xml = "\n".join(f'          <vertex x="{v[0]:.6f}" y="{v[1]:.6f}" z="{v[2]:.6f}" />' for v in verts)
        tri_xml = "\n".join(f'          <triangle v1="{f[0]}" v2="{f[1]}" v3="{f[2]}" />' for f in faces)
        obj2 = (
            f'    <object id="2" name="box_weak" type="model">\n'
            f'      <mesh>\n'
            f'        <vertices>\n{vert_xml}\n        </vertices>\n'
            f'        <triangles>\n{tri_xml}\n        </triangles>\n'
            f'      </mesh>\n'
            f'    </object>'
        )
        build_xml = '    <item objectid="1" />\n    <item objectid="2" />'
        write_3mf(path, obj1 + "\n" + obj2, build_xml)
        gcode = os.path.join(td, "pillar.gcode")
        rc = slice_3mf(path, gcode)
        if rc == 0 and os.path.exists(gcode):
            size = os.path.getsize(gcode)
            print(f"SUCCESS: G-code generated ({size} bytes)")
            with open(gcode, 'r') as f:
                content = f.read()
            labels = [l for l in content.split('\n') if 'printing object' in l.lower()]
            print(f"Object labels found: {len(labels)}")
            for l in labels[:10]:
                print(f"  {l}")
        else:
            print(f"FAILED: return code {rc}")


if __name__ == "__main__":
    test_single_object()
    test_multi_object_both_on_bed()
    test_multi_object_one_floating()
    test_multi_object_with_pillar()
