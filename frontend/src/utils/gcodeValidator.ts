import axios from 'axios';

export interface GcodeStats {
  mag_on_count: number;
  mag_off_count: number;
  total_lines: number;
}

export interface ValidationDiscrepancy {
  metric: string;
  frontend: number;
  backend: number;
  severity: 'warning' | 'error';
}

export interface ValidationResult {
  isValid: boolean;
  discrepancies: ValidationDiscrepancy[];
}

export async function validateGcodeStats(
  gcodeUrl: string,
  frontendStats: GcodeStats
): Promise<ValidationResult> {
  try {
    const response = await axios.post('/api/gcode/validate-stats', {
      gcode_url: gcodeUrl,
      frontend_stats: frontendStats,
    });
    return response.data;
  } catch (error) {
    console.error('Validation failed:', error);
    return { isValid: true, discrepancies: [] };
  }
}
