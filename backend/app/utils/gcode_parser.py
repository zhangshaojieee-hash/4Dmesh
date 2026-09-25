import re
from typing import Dict


def parse_gcode_statistics(gcode_text: str) -> Dict[str, float]:
    lines = gcode_text.split('\n')
    
    layer_count = 0
    extrusion_length_mm = 0.0
    print_time_seconds = 0.0
    mag_on_count = 0
    mag_off_count = 0
    
    current_e = 0.0
    current_feedrate = 1500.0
    last_x, last_y, last_z = 0.0, 0.0, 0.0
    
    for line in lines:
        stripped = line.strip()
        
        if stripped.startswith(';LAYER:'):
            layer_count += 1
        
        if 'M42' in stripped and 'P6' in stripped:
            if 'S255' in stripped:
                mag_on_count += 1
            elif 'S0' in stripped:
                mag_off_count += 1
        
        if stripped.startswith('G1') or stripped.startswith('G0'):
            f_match = re.search(r'F([\d.]+)', stripped)
            if f_match:
                current_feedrate = float(f_match.group(1))
            
            e_match = re.search(r'E([\d.-]+)', stripped)
            if e_match:
                new_e = float(e_match.group(1))
                if new_e > current_e:
                    extrusion_length_mm += (new_e - current_e)
                current_e = new_e
            
            x_match = re.search(r'X([\d.-]+)', stripped)
            y_match = re.search(r'Y([\d.-]+)', stripped)
            z_match = re.search(r'Z([\d.-]+)', stripped)
            
            new_x = float(x_match.group(1)) if x_match else last_x
            new_y = float(y_match.group(1)) if y_match else last_y
            new_z = float(z_match.group(1)) if z_match else last_z
            
            distance = ((new_x - last_x)**2 + (new_y - last_y)**2 + (new_z - last_z)**2)**0.5
            if distance > 0 and current_feedrate > 0:
                print_time_seconds += (distance / current_feedrate) * 60
            
            last_x, last_y, last_z = new_x, new_y, new_z
    
    return {
        'layer_count': layer_count,
        'extrusion_length_mm': round(extrusion_length_mm, 2),
        'print_time_seconds': round(print_time_seconds, 2),
        'mag_on_count': mag_on_count,
        'mag_off_count': mag_off_count
    }
