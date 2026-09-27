import asyncio
import hashlib
import io
import tempfile
import subprocess
import textwrap
import zipfile
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock

import pytest

import sys
import types

mock_models_module = types.ModuleType("app.api.models")
mock_models_module._validate_gltf_upload = MagicMock()
sys.modules.setdefault("app.api.models", mock_models_module)

mock_users_module = types.ModuleType("app.api.users")
mock_users_module.get_current_user = MagicMock()
sys.modules.setdefault("app.api.users", mock_users_module)

mock_db_module = types.ModuleType("app.core.database")
mock_db_module.SessionLocal = MagicMock()
mock_db_module.get_db = MagicMock()
sys.modules.setdefault("app.core.database", mock_db_module)

mock_orm_models = types.ModuleType("app.models")
mock_orm_models.User = MagicMock()
mock_orm_models.Model = MagicMock()
mock_orm_models.Notification = MagicMock()
mock_orm_models.Process4DTask = MagicMock()
mock_orm_models.Device = MagicMock()
mock_orm_models.PrintHistory = MagicMock()
mock_orm_models.Project = MagicMock()
sys.modules.setdefault("app.models", mock_orm_models)

mock_gcode_parser = types.ModuleType("app.utils.gcode_parser")
mock_gcode_parser.parse_gcode_statistics = MagicMock()
sys.modules.setdefault("app.utils.gcode_parser", mock_gcode_parser)

from app.api.gcode import (
    GridMagnetization,
    MagneticMetadata,
    _build_face_strength_map,
    _decode_surface_grid_rle,
    _export_mesh_as_3mf,
    _has_face_annotations,
    _map_strength_to_value,
    _get_slicing_face_limit,
    _normalize_direction,
    _parse_object_strength,
    _prepare_model_for_slicing,
    SliceRequest,
    find_prusaslicer,
    process_gcode_magnetic_by_path,
    process_gcode_magnetic_regions,
    reset_prusaslicer_cache,
    slice_model,
    slice_with_prusaslicer,
    _validate_grid_model_fingerprint,
)


def test_grid_fingerprint_accepts_matching_model_and_legacy_grid():
    with tempfile.NamedTemporaryFile(delete=False) as model_file:
        model_file.write(b"stage-one-model")
        model_path = model_file.name

    fingerprint = hashlib.sha256(b"stage-one-model").hexdigest()
    grid = GridMagnetization(
        modelFingerprint=fingerprint,
        coordinateSystemVersion=1,
        exportTransformVersion=1,
        cellSize=5,
        bboxMin=[0, 0, 0],
        bboxMax=[110, 110, 5],
        dimensions=[22, 22, 1],
        activeCells={"0:0:0": {"strength": 0.05, "direction": "Z+"}},
    )
    _validate_grid_model_fingerprint(grid, model_path)
    _validate_grid_model_fingerprint(
        GridMagnetization(
            cellSize=5,
            bboxMin=[0, 0, 0],
            bboxMax=[110, 110, 5],
            dimensions=[22, 22, 1],
        ),
        model_path,
    )


def test_grid_fingerprint_rejects_model_mismatch(tmp_path):
    model_path = tmp_path / "model.stl"
    model_path.write_bytes(b"different-model")
    grid = GridMagnetization(
        modelFingerprint=hashlib.sha256(b"expected-model").hexdigest(),
        coordinateSystemVersion=1,
        exportTransformVersion=1,
        cellSize=5,
        bboxMin=[0, 0, 0],
        bboxMax=[110, 110, 5],
        dimensions=[22, 22, 1],
    )
    with pytest.raises(Exception, match="网格磁化数据与当前模型不匹配"):
        _validate_grid_model_fingerprint(grid, str(model_path))


class TestParseObjectStrength:
    @pytest.mark.parametrize(
        "name, expected",
        [
            ("model_strong.3mf", "strong"),
            ("model_medium.3mf", "medium"),
            ("model_weak.3mf", "weak"),
            ("model_none.3mf", "none"),
            ("strong_magnet_weak.3mf", "weak"),
            ("model_STRONG.3mf", "strong"),
            ("random.3mf", None),
            ("model_unknown.3mf", None),
            ("model_strong.3mf id:0 copy 0", "strong"),
            ("", None),
            ("noext", None),
            ("_strong.3mf", "strong"),
        ],
    )
    def test_parse(self, name, expected):
        assert _parse_object_strength(name) == expected


class TestMapStrengthToValue:
    @pytest.mark.parametrize(
        "name, expected",
        [
            ("strong", 100),
            ("medium", 50),
            ("weak", 25),
            ("none", 0),
            ("STRONG", 100),
            ("unknown", 0),
        ],
    )
    def test_map(self, name, expected):
        assert _map_strength_to_value(name) == expected


class TestNormalizeDirection:
    @pytest.mark.parametrize(
        "direction, expected",
        [
            ([1, 0, 0], "X+"),
            ([-1, 0, 0], "X-"),
            ([0, 1, 0], "Y+"),
            ([0, -1, 0], "Y-"),
            ([0, 0, 1], "Z+"),
            ([0, 0, -1], "Z-"),
            ("+z", "Z+"),
            ("X", "X+"),
            (None, None),
        ],
    )
    def test_normalize_direction(self, direction, expected):
        assert _normalize_direction(direction) == expected


def _write_gcode(tmp_path, name, content):
    p = tmp_path / name
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return str(p)


def _read_output(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class TestProcessGcodeMagneticRegions:
    def test_two_objects_different_strengths(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            G28
            ; printing object model_strong.3mf id:0 copy 0
            G1 X10 Y10
            ; stop printing object model_strong.3mf id:0 copy 0
            ; printing object model_weak.3mf id:1 copy 0
            G1 X20 Y20
            ; stop printing object model_weak.3mf id:1 copy 0
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        assert result.count("MAG_ON S=100") == 1
        assert result.count("MAG_ON S=25") == 1
        assert result.count("MAG_OFF") >= 2

        lines = result.splitlines()
        mag_on_100_idx = next(i for i, l in enumerate(lines) if "MAG_ON S=100" in l)
        obj_strong_idx = next(i for i, l in enumerate(lines) if "; printing object model_strong" in l)
        assert mag_on_100_idx > obj_strong_idx

    def test_none_strength_no_mag(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            ; printing object model_none.3mf id:0 copy 0
            G1 X10
            ; stop printing object model_none.3mf id:0 copy 0
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        assert "MAG_ON" not in result
        assert "MAG_OFF" not in result

    def test_interleaved_layer_by_layer(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            ; printing object model_strong.3mf id:0 copy 0
            G1 Z0.2
            G1 X10
            ; stop printing object model_strong.3mf id:0 copy 0
            ; printing object model_weak.3mf id:1 copy 0
            G1 X20
            ; stop printing object model_weak.3mf id:1 copy 0
            ; printing object model_strong.3mf id:0 copy 0
            G1 Z0.4
            G1 X10
            ; stop printing object model_strong.3mf id:0 copy 0
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        assert result.count("MAG_ON S=100") == 2
        assert result.count("MAG_ON S=25") == 1

    def test_end_of_print_triggers_mag_off(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            ; printing object model_strong.3mf id:0 copy 0
            G1 X10
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        assert "MAG_ON S=100" in result
        assert "MAG_OFF" in result

    def test_same_strength_consecutive(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            ; printing object a_strong.3mf id:0 copy 0
            G1 X10
            ; stop printing object a_strong.3mf id:0 copy 0
            ; printing object b_strong.3mf id:1 copy 0
            G1 X20
            ; stop printing object b_strong.3mf id:1 copy 0
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        assert result.count("MAG_ON S=100") == 2
        assert result.count("MAG_OFF") >= 2

    def test_stop_inserts_mag_off(self, tmp_path):
        gcode = _write_gcode(tmp_path, "in.gcode", """\
            ; printing object model_strong.3mf id:0 copy 0
            G1 X10
            ; stop printing object model_strong.3mf id:0 copy 0
            G1 X50
            M84
        """)
        out = str(tmp_path / "out.gcode")
        process_gcode_magnetic_regions(gcode, [], out)
        result = _read_output(out)

        lines = result.splitlines()
        stop_idx = next(i for i, l in enumerate(lines) if "; stop printing object" in l)
        mag_off_after_stop = [i for i, l in enumerate(lines) if "MAG_OFF" in l and i > stop_idx]
        assert len(mag_off_after_stop) >= 1


def _metadata_for_volume_regions(volume_regions):
    return MagneticMetadata(
        source_mesh=None,
        export_transform={"scale": 1.0, "center_xy": [0.0, 0.0], "z_min": 0.0},
        bed_center=(0.0, 0.0),
        volume_regions=volume_regions,
    )


def _metadata_for_grid(grid_magnetization, bed_center=(0.0, 0.0)):
    return MagneticMetadata(
        source_mesh=None,
        export_transform={"scale": 1.0, "center_xy": [0.0, 0.0], "z_min": 0.0},
        bed_center=bed_center,
        grid_magnetization=grid_magnetization,
    )


class TestContinuousMagneticGcode:
    def test_grid_unset_cell_does_not_fallback_to_model_coordinates(self):
        metadata = MagneticMetadata(
            source_mesh=None,
            export_transform={"scale": 1.0, "center_xy": [0.0, 0.0], "z_min": 0.0},
            bed_center=(0.0, 0.0),
            grid_magnetization={
                "cellSize": 10,
                "bboxMin": [0, 0, -20],
                "bboxMax": [20, 20, 0],
                "dimensions": [2, 2, 2],
                "activeCells": {"0:0:0": {"strength": 0.1, "direction": "Z+"}},
            },
        )

        assert metadata.magnetic_at_gcode_position(5, 5, 5) == ("none", None)

    def test_grid_cell_injects_strength_and_direction(self, tmp_path):
        gcode = _write_gcode(tmp_path, "grid.gcode", """\\
            G90
            M82
            G1 X5 Y5 Z5 E1 F1200
            G1 X25 Y5 Z5 E2 F1200
            M84
        """)
        metadata = _metadata_for_grid({
            "cellSize": 10,
            "bboxMin": [0, 0, 0],
            "bboxMax": [20, 20, 20],
            "dimensions": [2, 2, 2],
            "activeCells": {"0:0:0": {"strength": 0.1, "direction": "Z+"}},
        })
        out = str(tmp_path / "grid_out.gcode")

        process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)

        assert "MAG_ON S=100 DIR=Z+" in result
        assert "MAG_OFF" in result

    def test_grid_boundary_splits_one_extrusion_move(self, tmp_path):
        gcode = _write_gcode(tmp_path, "partial_grid.gcode", """\
            G90
            M82
            G1 X0 Y0 Z5 E0
            G1 X10 Y0 Z5 E10 F1200
            M84
        """)
        metadata = _metadata_for_grid({
            "cellSize": 5,
            "bboxMin": [0, 0, -10],
            "bboxMax": [10, 10, 10],
            "dimensions": [2, 2, 4],
            "activeCells": {"0:1:2": {"strength": 0.1, "direction": "Z+"}},
        })
        out = str(tmp_path / "partial_grid_mag.gcode")

        stats = process_gcode_magnetic_by_path(gcode, out, metadata)
        lines = _read_output(out).splitlines()
        motion_lines = [line for line in lines if line.startswith("G1 X")]

        assert stats["mag_on_count"] == 1
        assert stats["mag_off_count"] == 1
        assert motion_lines == [
            "G1 X0 Y0 Z5 E0",
            "G1 X5 Y0 Z5 E5 F1200",
            "G1 X10 Y0 Z5 E10",
        ]
        assert lines.index("MAG_ON S=100 DIR=Z+") < lines.index("G1 X5 Y0 Z5 E5 F1200")
        assert lines.index("MAG_OFF") < lines.index("G1 X10 Y0 Z5 E10")

    def test_grid_middle_cell_splits_into_unmagnetized_magnetized_unmagnetized(self, tmp_path):
        gcode = _write_gcode(tmp_path, "middle_grid.gcode", """\
            G90
            M82
            G1 X0 Y0 Z5 E0
            G1 X15 Y0 Z5 E15 F1200
            M84
        """)
        metadata = _metadata_for_grid({
            "cellSize": 5,
            "bboxMin": [0, 0, -10],
            "bboxMax": [15, 10, 10],
            "dimensions": [3, 2, 4],
            "activeCells": {"1:1:2": {"strength": 0.1, "direction": "X+"}},
        })
        out = str(tmp_path / "middle_grid_mag.gcode")

        stats = process_gcode_magnetic_by_path(gcode, out, metadata)
        lines = _read_output(out).splitlines()
        motion_lines = [line for line in lines if line.startswith("G1 X")]

        assert stats["mag_on_count"] == 1
        assert stats["mag_off_count"] == 1
        assert motion_lines == [
            "G1 X0 Y0 Z5 E0",
            "G1 X5 Y0 Z5 E5 F1200",
            "G1 X10 Y0 Z5 E10",
            "G1 X15 Y0 Z5 E15",
        ]
        assert lines.index("MAG_ON S=100 DIR=X+") == lines.index("G1 X10 Y0 Z5 E10") - 1
        assert lines.index("MAG_OFF") == lines.index("G1 X15 Y0 Z5 E15") - 1

    def test_grid_mapping_uses_printer_bed_center(self):
        metadata = _metadata_for_grid({
            "cellSize": 5,
            "bboxMin": [0, 0, -5],
            "bboxMax": [10, 10, 5],
            "dimensions": [2, 2, 2],
            "activeCells": {"0:1:1": {"strength": 0.1, "direction": "Z+"}},
        }, bed_center=(125.0, 105.0))

        assert metadata.magnetic_at_gcode_position(2.5, 105, 5) == ("strong", "Z+")
        assert metadata.magnetic_at_gcode_position(5, 0, 5) == ("none", None)

    def test_single_object_3mf_export(self, tmp_path):
        trimesh = pytest.importorskip("trimesh")
        mesh = trimesh.creation.box(extents=(1, 1, 1))
        out = tmp_path / "single.3mf"

        transform = _export_mesh_as_3mf(mesh, str(out))

        with zipfile.ZipFile(out) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode("utf-8")

        assert model_xml.count("<object ") == 1
        assert model_xml.count("<item ") == 1
        assert "magstrong" not in model_xml
        assert "magmedium" not in model_xml
        assert "magweak" not in model_xml
        assert "unmag" not in model_xml
        assert transform["scale"] > 0
        assert len(transform["center_xy"]) == 2
        assert "z_min" in transform

    def test_none_paint_data_is_not_a_face_annotation(self):
        assert not _has_face_annotations(
            regions=[],
            paint_data={"mesh_0": {"none": [0, 1, 2, 3]}},
        )

    def test_none_paint_data_is_not_added_to_face_strength_map(self):
        trimesh = pytest.importorskip("trimesh")
        mesh = trimesh.creation.box(extents=(1, 1, 1))

        face_map = _build_face_strength_map(
            mesh,
            regions=[],
            paint_data={"mesh_0": {"none": list(range(len(mesh.faces))), "strong": [0, 1]}},
        )

        assert face_map == {0: "strong", 1: "strong"}

    def test_path_based_injection_turns_off_when_leaving_region(self, tmp_path):
        metadata = _metadata_for_volume_regions([
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "strong",
                "direction": [0, 0, 1],
                "transform": {"position": [5, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            }
        ])
        gcode = _write_gcode(tmp_path, "path.gcode", """\
            G90
            M82
            G1 X0 Y0 Z0.2 E0
            G1 X5 Y0 E0.2
            G1 X25 Y0 E0.4
            M84
        """)
        out = str(tmp_path / "path_mag.gcode")

        stats = process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)
        lines = result.splitlines()

        assert stats["mag_on_count"] == 1
        assert "MAG_ON S=100 DIR=Z+" in result
        assert "MAG_OFF" in result
        assert "; printing object" not in result
        assert lines.index("MAG_ON S=100 DIR=Z+") < next(i for i, line in enumerate(lines) if line.startswith("G1 X5"))
        assert lines.index("MAG_OFF") < next(i for i, line in enumerate(lines) if line.startswith("G1 X25"))

    def test_path_based_injection_supports_multiple_strengths(self, tmp_path):
        metadata = _metadata_for_volume_regions([
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "strong",
                "direction": [1, 0, 0],
                "transform": {"position": [5, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            },
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "medium",
                "direction": [0, 1, 0],
                "transform": {"position": [15, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            },
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "weak",
                "direction": [0, 0, -1],
                "transform": {"position": [25, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            },
        ])
        gcode = _write_gcode(tmp_path, "multi.gcode", """\
            G90
            M82
            G1 X0 Y0 Z0.2 E0
            G1 X5 Y0 E0.1
            G1 X15 Y0 E0.2
            G1 X25 Y0 E0.3
            G1 X40 Y0 E0.4
            M84
        """)
        out = str(tmp_path / "multi_mag.gcode")

        process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)

        assert "MAG_ON S=100 DIR=X+" in result
        assert "MAG_ON S=50 DIR=Y+" in result
        assert "MAG_ON S=25 DIR=Z-" in result
        assert result.count("MAG_OFF") >= 3

    def test_same_strength_direction_change_reemits_mag_on(self, tmp_path):
        metadata = _metadata_for_volume_regions([
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "strong",
                "direction": [1, 0, 0],
                "transform": {"position": [5, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            },
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "strong",
                "direction": [0, 1, 0],
                "transform": {"position": [15, 0, 0], "rotation": [0, 0, 0], "scale": [10, 10, 10]},
            },
        ])
        gcode = _write_gcode(tmp_path, "same_strength_dir.gcode", """\
            G90
            M82
            G1 X0 Y0 Z0.2 E0
            G1 X5 Y0 E0.1
            G1 X15 Y0 E0.2
            M84
        """)
        out = str(tmp_path / "same_strength_dir_mag.gcode")

        stats = process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)

        assert stats["mag_on_count"] == 2
        assert "MAG_ON S=100 DIR=X+" in result
        assert "MAG_ON S=100 DIR=Y+" in result

    def test_path_parser_handles_relative_extrusion_and_g92(self, tmp_path):
        metadata = _metadata_for_volume_regions([
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "weak",
                "direction": [0, 1, 0],
                "transform": {"position": [2, 0, 0], "rotation": [0, 0, 0], "scale": [4, 10, 10]},
            }
        ])
        gcode = _write_gcode(tmp_path, "relative.gcode", """\
            G90
            M83
            G1 X0 Y0 Z0.2 E0
            G1 X1 Y0 E-0.2
            G1 X2 Y0 E0.1
            G92 E0
            G1 X3 Y0 E0.3
            M84
        """)
        out = str(tmp_path / "relative_mag.gcode")

        process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)
        lines = result.splitlines()

        assert "MAG_ON S=25 DIR=Y+" in result
        assert "MAG_OFF" in result
        assert lines.index("MAG_ON S=25 DIR=Y+") > next(i for i, line in enumerate(lines) if line.startswith("G1 X2"))

    def test_z_only_extrusion_does_not_enable_magnet(self, tmp_path):
        metadata = _metadata_for_volume_regions([
            {
                "method": "box",
                "tag": "magnetic",
                "strengthId": "strong",
                "direction": [1, 0, 0],
                "transform": {"position": [5, 0, 0], "rotation": [0, 0, 0], "scale": [12, 12, 12]},
            }
        ])
        gcode = _write_gcode(tmp_path, "z_only.gcode", """\
            G90
            M82
            G1 X0 Y0 Z0.2 E0
            G1 Z0.4 E0.2
            G1 X5 Y0 E0.4
            M84
        """)
        out = str(tmp_path / "z_only_mag.gcode")

        process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)
        lines = result.splitlines()

        first_gcode_idx = next(i for i, line in enumerate(lines) if line.startswith("G1 Z0.4"))
        mag_on_idx = next(i for i, line in enumerate(lines) if "MAG_ON S=100 DIR=X+" in line)
        assert mag_on_idx > first_gcode_idx

    def test_surface_direction_applies_to_surface_strength(self, tmp_path):
        import base64

        data_b64 = base64.b64encode(bytes([1, 8])).decode("ascii")
        metadata = MagneticMetadata(
            source_mesh=None,
            export_transform={"scale": 1.0, "center_xy": [0.0, 0.0], "z_min": 0.0},
            bed_center=(0.0, 0.0),
            surface_paint_grid={
                "bbox_min": [0, 0, 0],
                "bbox_max": [2, 2, 2],
                "resolution": 2,
                "data_b64": data_b64,
            },
            surface_direction=[0, 0, -1],
        )
        gcode = _write_gcode(tmp_path, "surface_dir.gcode", """\
            G90
            M82
            G1 X0 Y0 Z0.2 E0
            G1 X1 Y0 E0.1
            M84
        """)
        out = str(tmp_path / "surface_dir_mag.gcode")

        process_gcode_magnetic_by_path(gcode, out, metadata)
        result = _read_output(out)

        assert "MAG_ON S=100 DIR=Z-" in result

    def test_surface_grid_decoder_rejects_oversized_resolution(self):
        with pytest.raises(ValueError):
            _decode_surface_grid_rle("AQE=", 129)

    def test_surface_grid_decoder_uses_compact_uint8_array(self):
        import base64

        data = _decode_surface_grid_rle(base64.b64encode(bytes([2, 8])).decode("ascii"), 2)

        assert data.shape == (2, 2, 2)
        assert str(data.dtype) == "uint8"
        assert data.sum() == 16


class TestSliceCommandConstruction:
    def test_low_memory_slice_limit_is_conservative(self, monkeypatch):
        monkeypatch.delenv("GCODE_SLICE_MAX_FACES", raising=False)
        monkeypatch.setattr("app.api.gcode._read_meminfo_kb", lambda: {"MemTotal": 1_870 * 1024})

        assert _get_slicing_face_limit() == 30_000

    def test_non_native_preflight_skips_materials(self, tmp_path, monkeypatch):
        import trimesh

        source = tmp_path / "textured.glb"
        source.write_bytes(b"not parsed")
        calls = []
        mesh = trimesh.creation.box(extents=(0.2, 0.5, 0.4))

        def fake_load(path, *, skip_materials=False):
            calls.append((path, skip_materials))
            return mesh

        monkeypatch.setattr("app.api.gcode._load_scene_or_mesh", fake_load)
        monkeypatch.setattr("app.api.gcode._get_slicing_face_limit", lambda: 100_000)

        prepared = _prepare_model_for_slicing(str(source), str(tmp_path))

        assert prepared.endswith(".3mf")
        assert calls == [(str(source), True)]

    def test_slice_endpoint_defers_non_native_conversion_to_slicer_preflight(self, tmp_path, monkeypatch):
        model_path = tmp_path / "uploaded.glb"
        model_path.write_bytes(b"not parsed in endpoint")
        output_path = tmp_path / "out.gcode"
        calls = []

        def fail_if_loaded(_model_path):
            raise AssertionError("slice endpoint should not pre-load non-native models")

        async def fake_run_heavy_task(label, fn, *args, **kwargs):
            calls.append((label, fn, args, kwargs))
            assert label == "切片"
            assert args[0] == [str(model_path)]
            return str(output_path)

        monkeypatch.setattr("app.api.gcode._resolve_model_path", lambda _url: str(model_path))
        monkeypatch.setattr("app.api.gcode._load_scene_or_mesh", fail_if_loaded)
        monkeypatch.setattr("app.api.gcode.run_heavy_task", fake_run_heavy_task)

        result = asyncio.run(slice_model(SliceRequest(model_path="uploaded.glb")))

        assert result["success"] is True
        assert result["gcode_path"] == str(output_path)
        assert len(calls) == 1

    def test_small_non_native_model_is_normalized_to_scaled_3mf(self, tmp_path, monkeypatch):
        trimesh = pytest.importorskip("trimesh")
        mesh = trimesh.creation.box(extents=(0.2, 0.5, 0.4))
        model_path = tmp_path / "meter_scale.glb"
        mesh.export(model_path, file_type="glb")

        monkeypatch.setattr("app.api.gcode._get_slicing_face_limit", lambda: 100_000)

        prepared = _prepare_model_for_slicing(str(model_path), str(tmp_path))

        assert prepared.endswith(".3mf")
        with zipfile.ZipFile(prepared) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode("utf-8")
        root = ET.fromstring(model_xml)
        namespace = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
        xs = [float(vertex.attrib["x"]) for vertex in root.findall(".//m:vertex", namespace)]
        ys = [float(vertex.attrib["y"]) for vertex in root.findall(".//m:vertex", namespace)]
        zs = [float(vertex.attrib["z"]) for vertex in root.findall(".//m:vertex", namespace)]

        assert max(xs) - min(xs) > 50
        assert max(ys) - min(ys) > 150
        assert max(zs) - min(zs) > 100


class TestAiTemporaryUpload:
    def _fake_db(self):
        return types.SimpleNamespace(
            add=MagicMock(),
            commit=MagicMock(),
            refresh=lambda model: setattr(model, "id", 42),
        )

    def test_browser_previewable_upload_skips_glb_conversion(self, tmp_path, monkeypatch):
        from fastapi import UploadFile
        import app.api.ai as ai

        async def fail_run_heavy_task(*_args, **_kwargs):
            raise AssertionError("direct-preview formats should not start a GLB conversion task")

        def fail_load(*_args, **_kwargs):
            raise AssertionError("direct-preview formats should not be loaded by trimesh")

        monkeypatch.setattr(ai, "TEMP_DIR", str(tmp_path))
        monkeypatch.setattr(ai, "run_heavy_task", fail_run_heavy_task)
        monkeypatch.setattr(ai, "_load_scene_or_mesh", fail_load)
        monkeypatch.setattr(ai, "generate_model_thumbnail_file", lambda _path, _file_size=None: "draft-thumb.png")
        captured_draft = {}

        def fake_create_draft_model_record(_db, **kwargs):
            captured_draft.update(kwargs)
            return types.SimpleNamespace(id=42, retention_expires_at=None)

        monkeypatch.setattr(ai, "create_draft_model_record", fake_create_draft_model_record)

        db = self._fake_db()
        upload = UploadFile(file=io.BytesIO(b"glb-data"), filename="direct.glb")
        result = asyncio.run(ai.upload_temp_model(upload, current_user=types.SimpleNamespace(id=7), db=db))

        assert result["model_url"].startswith("/api/models/file/draft_7_")
        assert result["preview_url"] == result["model_url"]
        assert result["format"] == "glb"
        assert result["model_id"] == 42
        assert captured_draft["thumbnail_path"] == "draft-thumb.png"

    def test_non_previewable_upload_conversion_uses_heavy_limiter_and_skips_materials(self, tmp_path, monkeypatch):
        from fastapi import UploadFile
        import app.api.ai as ai

        calls = []

        def fake_load(path, *, skip_materials=False):
            calls.append(("load", path, skip_materials))
            return object()

        def fake_export(_mesh, output_path):
            calls.append(("export", output_path))
            with open(output_path, "wb") as output:
                output.write(b"glb")

        async def fake_run_heavy_task(label, fn, *args, **kwargs):
            calls.append(("heavy", label))
            return fn(*args, **kwargs)

        monkeypatch.setattr(ai, "TEMP_DIR", str(tmp_path))
        monkeypatch.setattr(ai, "_load_scene_or_mesh", fake_load)
        monkeypatch.setattr(ai, "_export_mesh_as_glb", fake_export)
        monkeypatch.setattr(ai, "run_heavy_task", fake_run_heavy_task)
        monkeypatch.setattr(ai, "_release_process_memory", lambda: None)
        monkeypatch.setattr(ai, "generate_model_thumbnail_file", lambda _path, _file_size=None: "converted-draft-thumb.png")
        captured_draft = {}

        def fake_create_draft_model_record(_db, **kwargs):
            captured_draft.update(kwargs)
            return types.SimpleNamespace(id=42, retention_expires_at=None)

        monkeypatch.setattr(ai, "create_draft_model_record", fake_create_draft_model_record)

        db = self._fake_db()
        upload = UploadFile(file=io.BytesIO(b"step-data"), filename="part.step")
        result = asyncio.run(ai.upload_temp_model(upload, current_user=types.SimpleNamespace(id=9), db=db))

        assert result["model_url"].startswith("/api/models/file/draft_9_")
        assert result["preview_url"].endswith("_preview.glb")
        assert result["format"] == "glb"
        assert result["model_id"] == 42
        assert ("heavy", "临时模型预览转换") in calls
        assert any(call[0] == "load" and call[2] is True for call in calls)
        assert captured_draft["thumbnail_path"] == "converted-draft-thumb.png"

    def test_missing_prusaslicer_reports_server_configuration(self, tmp_path, monkeypatch):
        dummy_stl = tmp_path / "test.stl"
        dummy_stl.write_text("dummy")

        monkeypatch.setattr("app.api.gcode.find_prusaslicer", lambda: None)

        with pytest.raises(Exception) as exc_info:
            slice_with_prusaslicer([str(dummy_stl)], str(tmp_path / "output.gcode"))

        assert getattr(exc_info.value, "status_code", None) == 501
        assert "服务器未配置 PrusaSlicer" in str(getattr(exc_info.value, "detail", ""))

    def test_find_prusaslicer_uses_server_env_path(self, tmp_path, monkeypatch):
        fake_slicer = tmp_path / ("prusa-slicer-console.bat" if sys.platform.startswith("win") else "prusa-slicer")
        if sys.platform.startswith("win"):
            fake_slicer.write_text("@echo off\necho PrusaSlicer 2.8.0\n", encoding="ascii")
        else:
            fake_slicer.write_text("#!/bin/sh\necho PrusaSlicer 2.8.0\n", encoding="ascii")
            fake_slicer.chmod(0o755)

        monkeypatch.setenv("PRUSASLICER_PATH", str(fake_slicer))
        reset_prusaslicer_cache()
        try:
            assert find_prusaslicer() == str(fake_slicer)
        finally:
            reset_prusaslicer_cache()

    def test_label_objects_in_command(self, tmp_path, monkeypatch):
        dummy_stl = tmp_path / "test.stl"
        dummy_stl.write_text("dummy")
        output_path = str(tmp_path / "output.gcode")

        captured_cmd = []

        class MockPopen:
            returncode = 0
            pid = 12345

            def __init__(self, cmd, **kwargs):
                captured_cmd.extend(cmd)

            def communicate(self, timeout=None):
                with open(output_path, "w") as f:
                    f.write("G28\n")
                return "", ""

            def poll(self):
                return 0

        monkeypatch.setattr(subprocess, "Popen", MockPopen)
        monkeypatch.setattr("app.api.gcode.find_prusaslicer", lambda: "/usr/bin/prusa-slicer")

        slice_with_prusaslicer([str(dummy_stl)], output_path)

        assert "--gcode-label-objects" in captured_cmd
        assert "octoprint" in captured_cmd
        assert "-g" in captured_cmd
        g_idx = captured_cmd.index("-g")
        label_idx = captured_cmd.index("--gcode-label-objects")
        assert label_idx == g_idx + 1
        assert captured_cmd[label_idx + 1] == "octoprint"
