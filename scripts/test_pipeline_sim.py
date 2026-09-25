"""Test: voxel-based multi-object splitting + PrusaSlicer slicing."""
import os
import sys
import subprocess
import tempfile

os.environ.setdefault("JWT_SECRET_KEY", "test_secret_for_pipeline_sim")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

import trimesh
import numpy as np


def test_voxel_split_pipeline():
    print("=" * 60)
    print("TEST 1: Both groups touch bed (baseline)")
    print("=" * 60)

    mesh = trimesh.creation.box(extents=[20, 20, 40])
    mesh.apply_translation([0, 0, 20])

    face_count = len(mesh.faces)
    half = face_count // 2
    face_strength_map = {i: "strong" for i in range(half)}
    face_strength_map.update({i: "weak" for i in range(half, face_count)})

    run_split_and_slice(mesh, face_strength_map, "test1")


def test_floating_object():
    print("\n" + "=" * 60)
    print("TEST 2: Floating 'strong' region (top faces only)")
    print("=" * 60)

    mesh = trimesh.creation.box(extents=[20, 20, 40])
    mesh.apply_translation([0, 0, 20])

    normals = mesh.face_normals
    face_strength_map = {}
    for i in range(len(mesh.faces)):
        if normals[i][2] > 0.9:
            face_strength_map[i] = "strong"
        else:
            face_strength_map[i] = "none"

    strong_count = sum(1 for v in face_strength_map.values() if v == "strong")
    none_count = sum(1 for v in face_strength_map.values() if v == "none")
    print(f"Face assignments: {strong_count} strong (top), {none_count} none (rest)")

    run_split_and_slice(mesh, face_strength_map, "test2_floating")


def run_split_and_slice(mesh, face_strength_map, label):
    from app.api.gcode import _split_mesh_by_voxel_strength, _export_multi_object_3mf

    print(f"Mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces, watertight={mesh.is_watertight}")

    strength_solids = _split_mesh_by_voxel_strength(mesh, face_strength_map)

    print(f"\nVoxel split results:")
    for name, solid in strength_solids.items():
        print(f"  {name}: {len(solid.vertices)} verts, {len(solid.faces)} faces, watertight={solid.is_watertight}")
        print(f"    bounds: {solid.bounds[0]} to {solid.bounds[1]}")

    if not strength_solids:
        print("FAILED: No solids produced")
        return

    with tempfile.TemporaryDirectory() as td:
        named_meshes = {f"{label}_{s}": m for s, m in strength_solids.items()}
        path_3mf = os.path.join(td, f"{label}_combined.3mf")
        _export_multi_object_3mf(named_meshes, path_3mf)
        print(f"\n3MF written: {os.path.getsize(path_3mf)} bytes, {len(named_meshes)} objects")

        prusaslicer = r"F:\PrusaSlicer\PrusaSlicer\prusa-slicer-console.EXE"
        configs_dir = os.path.join(os.path.dirname(__file__), '..', 'backend', 'configs')
        gcode_path = os.path.join(td, f"{label}.gcode")
        cmd = [
            prusaslicer, "-g",
            "--load", os.path.join(configs_dir, "bambu_x1c.ini"),
            "--load", os.path.join(configs_dir, "quality_0.20mm.ini"),
            "--gcode-label-objects", "octoprint",
            "--dont-arrange",
            "--center", "110,110",
            "-o", gcode_path,
            path_3mf,
        ]
        print(f"\nSlicing...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        print(f"Return code: {result.returncode}")
        if result.stdout:
            print(f"stdout: {result.stdout[:500]}")
        if result.stderr:
            print(f"stderr: {result.stderr[:500]}")

        if result.returncode == 0 and os.path.exists(gcode_path):
            size = os.path.getsize(gcode_path)
            with open(gcode_path, 'r') as f:
                content = f.read()
            labels = [l for l in content.split('\n') if 'printing object' in l.lower()]
            print(f"\nSUCCESS: G-code {size} bytes, {len(labels)} object labels")
            for l in labels[:10]:
                print(f"  {l}")
        else:
            print(f"\nFAILED: return code {result.returncode}")


def test_meter_unit_model():
    print("\n" + "=" * 60)
    print("TEST 3: Meter-unit model (simulates GLB import)")
    print("=" * 60)

    mesh = trimesh.creation.box(extents=[0.020, 0.020, 0.040])
    mesh.apply_translation([0, 0, 0.020])
    print(f"Extents: {mesh.extents} (meters)")

    normals = mesh.face_normals
    face_strength_map = {}
    for i in range(len(mesh.faces)):
        if normals[i][2] > 0.9:
            face_strength_map[i] = "strong"
        else:
            face_strength_map[i] = "none"

    strong_count = sum(1 for v in face_strength_map.values() if v == "strong")
    print(f"Face assignments: {strong_count} strong, {len(mesh.faces) - strong_count} none")

    run_split_and_slice(mesh, face_strength_map, "test3_meter")


if __name__ == "__main__":
    test_voxel_split_pipeline()
    test_floating_object()
    test_meter_unit_model()
