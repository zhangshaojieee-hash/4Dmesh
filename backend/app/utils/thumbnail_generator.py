import os
from typing import Tuple
import io

DEFAULT_AUTO_THUMBNAIL_MAX_MODEL_SIZE = 10 * 1024 * 1024


def _auto_thumbnail_max_model_size() -> int:
    raw_value = os.getenv("AUTO_THUMBNAIL_MAX_MODEL_SIZE_MB", "").strip()
    if not raw_value:
        return DEFAULT_AUTO_THUMBNAIL_MAX_MODEL_SIZE
    try:
        value = int(raw_value)
    except ValueError:
        return DEFAULT_AUTO_THUMBNAIL_MAX_MODEL_SIZE
    return max(0, value) * 1024 * 1024


def generate_thumbnail(model_path: str, output_path: str, size: Tuple[int, int] = (400, 300)) -> bool:
    try:
        import numpy as np
        import trimesh
        from PIL import Image

        mesh = trimesh.load(model_path, force='mesh')
        
        if isinstance(mesh, trimesh.Scene):
            meshes = [trimesh.Trimesh(vertices=g.vertices, faces=g.faces)
                     for g in mesh.geometry.values()]
            if not meshes:
                return False
            mesh = trimesh.util.concatenate(tuple(meshes))
        
        if not isinstance(mesh, trimesh.Trimesh):
            return False
        
        scene = trimesh.Scene(mesh)
        
        bounds = mesh.bounds
        extents = bounds[1] - bounds[0]
        max_extent = np.max(extents)
        
        distance = max_extent * 2.5
        camera_transform = np.eye(4)
        camera_transform[2, 3] = distance
        
        scene.camera_transform = camera_transform
        
        png_bytes = scene.save_image(resolution=size, visible=True)
        
        if isinstance(png_bytes, bytes):
            img = Image.open(io.BytesIO(png_bytes))
        else:
            img = Image.open(png_bytes)
            
        img.save(output_path, 'PNG')
        
        return True
        
    except Exception as e:
        print(f"Error generating thumbnail: {e}")
        return False


def should_generate_thumbnail(file_path: str, file_size: int | None = None) -> bool:
    """
    Check if a file type supports thumbnail generation.
    
    Args:
        file_path: Path to the model file
    
    Returns:
        True if thumbnail can be generated
    """
    ext = os.path.splitext(file_path)[1].lower()
    supported_formats = {'.stl', '.obj', '.glb', '.gltf', '.3mf', '.ply', '.off'}
    if ext not in supported_formats:
        return False

    max_size = _auto_thumbnail_max_model_size()
    if max_size == 0:
        return False
    if file_size is None:
        try:
            file_size = os.path.getsize(file_path)
        except OSError:
            return False
    return file_size <= max_size
