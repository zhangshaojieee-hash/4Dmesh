import axios, { type AxiosRequestConfig } from 'axios';
import type { TaskStatus } from '../types';
import { getFileName, getFilePathSegment } from '../utils/path';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const path = window.location.pathname;
      if (path !== '/login') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        const target = `${window.location.pathname}${window.location.search}`;
        const redirect = target && target !== '/login' ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
        window.location.replace(redirect);
      }
    }
    return Promise.reject(error);
  },
);

// ========== Model API ==========

export interface ModelData {
  id: number;
  name: string;
  description: string;
  category: string;
  file_path: string;
  thumbnail_path: string | null;
  downloads: number;
  likes: number;
  favorites?: number;
  feedback_count?: number;
  rating?: number | null;
  views?: number;
  user_id: number;
  author: string;
  created_at: string;
  liked_by_current_user?: boolean;
  favorited_by_current_user?: boolean;
  version_number?: number;
  parent_model_id?: number | null;
  lifecycle_status?: string;
  retention_expires_at?: string | null;
  source_type?: string | null;
}

export interface ModelsResponse {
  total: number;
  models: ModelData[];
}

export const getModels = async (params?: {
  category?: string;
  search?: string;
  sort_by?: string;
  skip?: number;
  limit?: number;
}): Promise<ModelsResponse> => {
  const response = await apiClient.get('/models/', { params });
  return response.data;
};

export const getDraftModels = async (params?: {
  skip?: number;
  limit?: number;
}): Promise<ModelsResponse> => {
  const response = await apiClient.get('/models/drafts', { params });
  return response.data;
};

export const getModel = async (id: number): Promise<ModelData> => {
  const response = await apiClient.get(`/models/${id}`);
  return response.data;
};

export const uploadModel = async (
  file: File,
  name: string,
  description?: string,
  category?: string,
  thumbnail?: File,
) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) formData.append('description', description);
  if (category) formData.append('category', category);
  if (thumbnail) formData.append('thumbnail', thumbnail);
  const response = await apiClient.post('/models/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const retainModel = async (
  id: number,
  name: string,
  description?: string,
  category?: string,
  thumbnail?: File,
): Promise<ModelData> => {
  const formData = new FormData();
  formData.append('name', name);
  if (description) formData.append('description', description);
  if (category) formData.append('category', category);
  if (thumbnail) formData.append('thumbnail', thumbnail);
  const response = await apiClient.post(`/models/${id}/retain`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data as ModelData;
};

export const updateModel = async (
  id: number,
  name: string,
  description: string,
  category: string,
) => {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('category', category);
  const response = await apiClient.put(`/models/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteModel = async (id: number) => {
  const response = await apiClient.delete(`/models/${id}`);
  return response.data;
};

export const likeModel = async (id: number) => {
  const response = await apiClient.post(`/models/${id}/like`);
  return response.data;
};

export const getUserModels = async (userId: number) => {
  const response = await apiClient.get(`/models/user/${userId}`);
  return response.data;
};

export const getModelVersions = async (modelId: number): Promise<ModelData[]> => {
  const response = await apiClient.get(`/models/${modelId}/versions`);
  return response.data;
};

export const uploadModelVersion = async (
  parentModelId: number,
  file: File,
  name: string,
  description?: string,
  category?: string,
  thumbnail?: File,
) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  formData.append('parent_model_id', parentModelId.toString());
  if (description) formData.append('description', description);
  if (category) formData.append('category', category);
  if (thumbnail) formData.append('thumbnail', thumbnail);
  const response = await apiClient.post('/models/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getModelDownloadUrl = (filename: string) =>
  `${API_BASE}/models/download/${getFilePathSegment(filename)}`;

export const getModelFileUrl = (filename: string) =>
  `${API_BASE}/models/file/${getFilePathSegment(filename)}`;

export const getThumbnailUrl = (filename: string) =>
  `${API_BASE}/models/thumbnail/${getFilePathSegment(filename)}`;

export const getAvatarUrl = (filename: string) =>
  `${API_BASE}/users/avatar/${getFilePathSegment(filename)}`;

// ========== G-code API ==========

export const uploadGcode = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/gcode/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const insertMagnetic = async (data: FormData) => {
  const response = await apiClient.post('/gcode/insert-magnetic', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const splitModel = async (data: {
  model_url: string;
  regions: unknown[];
  paint_data?: unknown;
  volume_regions?: unknown[];
  surface_paint_grid?: unknown;
  output_format?: string;
}) => {
  const response = await apiClient.post('/gcode/split-model', data);
  return response.data;
};

export const sliceModel = async (data: {
  model_path: string;
  printer_profile?: string;
  quality?: string;
}) => {
  const response = await apiClient.post('/gcode/slice', data);
  return response.data;
};

export const processGcode = async (data: { gcode_path: string; regions: unknown[] }) => {
  const response = await apiClient.post('/gcode/process-gcode', data);
  return response.data;
};

export interface Process4DPayload {
  model_url: string;
  regions: unknown[];
  paint_data?: unknown;
  volume_regions?: unknown[];
  surface_paint_grid?: unknown;
  surface_direction?: [number, number, number] | null;
  grid_magnetization?: unknown;
  printer_profile?: string;
  quality?: string;
}

export interface Process4DResponse {
  success: boolean;
  output_path?: string;
  filename?: string;
  download_url?: string;
  stats?: {
    mag_on_count: number;
    mag_off_count: number;
    grid_hit_count?: number;
    total_lines: number;
  };
  split_result?: {
    files: Record<string, { filename: string; download_url: string }>;
    split_count: number;
  };
  model_result?: {
    single_model_3mf: string;
    continuous_model: boolean;
    magnetic_mode: 'offline_gcode_path' | 'legacy_object_label';
  };
  slice_result?: {
    gcode_path: string | null;
    download_url: string | null;
    multi_object_mode?: boolean;
  };
  message?: string;
  error?: string;
}

export interface Process4DTaskLog {
  time: string;
  stage: string | null;
  status: Process4DTaskStatus;
  progress: number;
  message: string;
}

export type Process4DTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Process4DTask {
  success: boolean;
  task_id: string;
  status: Process4DTaskStatus;
  progress: number;
  current_stage: string | null;
  message: string | null;
  logs: Process4DTaskLog[];
  result: Process4DResponse | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const process4D = async (data: Process4DPayload) => {
  const response = await apiClient.post('/gcode/process-4d', data);
  return response.data as Process4DResponse;
};

export const createProcess4DTask = async (data: Process4DPayload): Promise<Process4DTask> => {
  const response = await apiClient.post('/gcode/process-4d/tasks', data);
  return response.data as Process4DTask;
};

export const getProcess4DTask = async (taskId: string): Promise<Process4DTask> => {
  const response = await apiClient.get(`/gcode/process-4d/tasks/${taskId}`);
  return response.data as Process4DTask;
};

export const cancelProcess4DTask = async (taskId: string): Promise<Process4DTask> => {
  const response = await apiClient.post(`/gcode/process-4d/tasks/${taskId}/cancel`);
  return response.data as Process4DTask;
};

export interface Process4DTaskSummary {
  task_id: string;
  status: Process4DTaskStatus;
  progress: number;
  current_stage: string | null;
  message: string | null;
  error: string | null;
  filename: string | null;
  download_url: string | null;
  created_at: string;
  updated_at: string;
}

export const listProcess4DTasks = async (): Promise<Process4DTaskSummary[]> => {
  const response = await apiClient.get('/gcode/process-4d/tasks');
  return (response.data?.tasks ?? []) as Process4DTaskSummary[];
};

export const getGcodeContent = async (filename: string) => {
  const response = await apiClient.get(`/gcode/content/${getFilePathSegment(filename)}`);
  return response.data;
};

export const saveGcode = async (filename: string, content: string) => {
  const response = await apiClient.post('/gcode/save', { filename: getFileName(filename), content });
  return response.data as {
    success: boolean;
    filename: string;
    download_url: string;
    total_lines: number;
    total_layers: number;
    mag_on_count: number;
    mag_off_count: number;
  };
};

export const downloadGcodeUrl = (filename: string) =>
  `${API_BASE}/gcode/download/${getFilePathSegment(filename)}`;

// ========== Device API ==========

export interface UploadGcodeToDeviceResult {
  success: boolean;
  filename: string;
  remote_path?: string;
  remotePath?: string;
  uploaded: boolean;
  print_started: boolean;
  print_queued?: boolean;
  printQueued?: boolean;
  history_id?: number;
}

export const uploadGcodeToDevice = async (
  deviceId: string,
  filename: string,
  startPrint = false,
  meta?: { model_id?: number | null; model_name?: string | null },
): Promise<UploadGcodeToDeviceResult> => {
  const response = await apiClient.post(`/devices/${deviceId}/upload-gcode`, {
    filename: getFileName(filename),
    start_print: startPrint,
    model_id: meta?.model_id ?? undefined,
    model_name: meta?.model_name ?? undefined,
  });
  return response.data;
};

// ========== AI API ==========

export type AIQualityTier = 'fast' | 'quality' | 'pro';

export interface AITaskResponse {
  task_id: string;
}

export interface TextTo3DRequest {
  prompt: string;
  quality: AIQualityTier;
}

export interface UploadTempResponse {
  model_url: string;
  preview_url: string;
  format?: string;
  model_id?: number;
  retention_expires_at?: string | null;
}

export interface DownloadModelProxyResponse {
  local_url: string;
  filename?: string | null;
  model_id?: number;
  retention_expires_at?: string | null;
}

type TimeoutOptions = Pick<AxiosRequestConfig, 'timeout'>;

export const imageTo3D = async (file: File, quality: AIQualityTier = 'fast'): Promise<AITaskResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('quality', quality);
  const response = await apiClient.post('/ai/image-to-3d', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const textTo3D = async (payload: TextTo3DRequest): Promise<AITaskResponse> => {
  const response = await apiClient.post('/ai/text-to-3d', payload);
  return response.data;
};

export const getTaskStatus = async (taskId: string, options?: TimeoutOptions): Promise<TaskStatus> => {
  const response = await apiClient.get(`/ai/task/${taskId}`, options);
  return response.data;
};

export const checkBalance = async () => {
  const response = await apiClient.get('/ai/balance');
  return response.data;
};

export const uploadTemp = async (file: File): Promise<UploadTempResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/ai/upload-temp', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const downloadModelProxy = async (url: string, options?: TimeoutOptions): Promise<DownloadModelProxyResponse> => {
  const response = await apiClient.get('/ai/download-model', {
    params: { url },
    ...options,
  });
  return response.data;
};

export type PrintHistoryStatus = 'uploaded' | 'queued' | 'started' | 'printing' | 'completed' | 'failed' | 'cancelled';

export interface PrintHistoryRecord {
  id: number;
  model_id: number | null;
  device_id: number | null;
  model_name: string;
  gcode_filename: string | null;
  remote_path: string | null;
  status: PrintHistoryStatus;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  notes: string | null;
}

export interface PrintHistoryResponse {
  total: number;
  records: PrintHistoryRecord[];
}

export const getPrintHistory = async (params?: { skip?: number; limit?: number }) => {
  const response = await apiClient.get('/print-history/', { params });
  return response.data as PrintHistoryResponse;
};

export const createPrintHistory = async (payload: {
  model_name: string;
  model_id?: number | null;
  device_id?: number | null;
  gcode_filename?: string | null;
  remote_path?: string | null;
  status: PrintHistoryStatus;
  notes?: string;
}) => {
  const response = await apiClient.post('/print-history/', payload);
  return response.data as PrintHistoryRecord;
};

export const updatePrintHistory = async (
  id: number,
  payload: { status?: PrintHistoryStatus; completed_at?: string | null; notes?: string | null },
) => {
  const response = await apiClient.patch(`/print-history/${id}`, payload);
  return response.data as PrintHistoryRecord;
};

export const deletePrintHistory = async (id: number) => {
  const response = await apiClient.delete(`/print-history/${id}`);
  return response.data;
};

export interface CommentData {
  id: number;
  content: string;
  model_id: number;
  user_id: number;
  username: string;
  created_at: string | null;
}

export interface CommentsResponse {
  total: number;
  comments: CommentData[];
}

export const getModelComments = async (modelId: number, params?: { skip?: number; limit?: number }) => {
  const response = await apiClient.get(`/comments/model/${modelId}`, { params });
  return response.data as CommentsResponse;
};

export const createComment = async (modelId: number, content: string) => {
  const response = await apiClient.post(`/comments/model/${modelId}`, { content });
  return response.data as CommentData;
};

export const deleteComment = async (commentId: number) => {
  const response = await apiClient.delete(`/comments/${commentId}`);
  return response.data;
};

// ========== Follow API ==========

export interface FollowStatusData {
  is_followed: boolean;
  followers_count: number;
  following_count: number;
}

export interface FollowUserData {
  id: number;
  username: string;
  avatar_path: string | null;
}

export interface FollowListResponse {
  total: number;
  users: FollowUserData[];
}

export const toggleFollow = async (userId: number) => {
  const response = await apiClient.post(`/users/${userId}/follow`);
  return response.data as { followed: boolean; followers_count: number; following_count: number };
};

export const getFollowStatus = async (userId: number): Promise<FollowStatusData> => {
  const response = await apiClient.get(`/users/${userId}/follow-status`);
  return response.data;
};

export const getFollowers = async (userId: number, params?: { skip?: number; limit?: number }): Promise<FollowListResponse> => {
  const response = await apiClient.get(`/users/${userId}/followers`, { params });
  return response.data;
};

export const getFollowing = async (userId: number, params?: { skip?: number; limit?: number }): Promise<FollowListResponse> => {
  const response = await apiClient.get(`/users/${userId}/following`, { params });
  return response.data;
};

// ========== Favorites API ==========

export interface FavoriteStatusData {
  is_favorited: boolean;
  favorites_count: number;
}

export const toggleFavorite = async (modelId: number) => {
  const response = await apiClient.post(`/models/${modelId}/favorite`);
  return response.data as { favorited: boolean; favorites_count: number };
};

export const getFavoriteStatus = async (modelId: number): Promise<FavoriteStatusData> => {
  const response = await apiClient.get(`/models/${modelId}/favorite-status`);
  return response.data;
};

export const getMyFavorites = async (params?: { skip?: number; limit?: number }): Promise<ModelsResponse> => {
  const response = await apiClient.get('/models/my-favorites', { params });
  return response.data;
};

// ========== Community API ==========

export interface NotificationData {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
  actor_user_id: number | null;
  model_id: number | null;
}

export interface NotificationsResponse {
  total: number;
  unread_count: number;
  notifications: NotificationData[];
}

export const getNotifications = async (params?: { unread_only?: boolean; skip?: number; limit?: number }) => {
  const response = await apiClient.get('/notifications/', { params });
  return response.data as NotificationsResponse;
};

export const markNotificationRead = async (id: number) => {
  const response = await apiClient.post(`/notifications/${id}/read`);
  return response.data as NotificationData;
};

export const markAllNotificationsRead = async () => {
  const response = await apiClient.post('/notifications/read-all');
  return response.data as { success: boolean };
};

export interface PrintFeedbackData {
  id: number;
  model_id: number;
  user_id: number;
  username: string;
  rating: number;
  content: string;
  printer_model: string | null;
  material: string | null;
  gcode_filename: string | null;
  print_history_id: number | null;
  created_at: string;
}

export interface PrintFeedbackResponse {
  total: number;
  feedback: PrintFeedbackData[];
}

export const createModelReport = async (
  modelId: number,
  payload: { reason: string; details?: string | null },
) => {
  const response = await apiClient.post(`/community/models/${modelId}/reports`, payload);
  return response.data;
};

export const getPrintFeedback = async (modelId: number, params?: { skip?: number; limit?: number }) => {
  const response = await apiClient.get(`/community/models/${modelId}/feedback`, { params });
  return response.data as PrintFeedbackResponse;
};

export const createPrintFeedback = async (
  modelId: number,
  payload: {
    rating: number;
    content: string;
    printer_model?: string | null;
    material?: string | null;
    print_history_id?: number | null;
    gcode_filename?: string | null;
  },
) => {
  const response = await apiClient.post(`/community/models/${modelId}/feedback`, payload);
  return response.data as PrintFeedbackData;
};

// ========== Project API ==========

export interface ProjectData {
  id: string;
  user_id: number;
  name: string;
  model_url: string;
  model_id: number | null;
  model_name: string | null;
  regions: unknown[];
  paint_data: Record<string, unknown>;
  modules: unknown[];
  volume_regions: unknown[];
  surface_regions: unknown[];
  process_rules: unknown[];
  surface_paint_grid: Record<string, unknown> | null;
  surface_direction: [number, number, number] | null;
  grid_magnetization: Record<string, unknown> | null;
  input_type: string | null;
  source_file: Record<string, unknown> | null;
  gcode_info: Record<string, unknown> | null;
  step: string;
  split_result: Record<string, unknown> | null;
  model_result: Record<string, unknown> | null;
  slice_result: Record<string, unknown> | null;
  gcode_result: Record<string, unknown> | null;
  printer_profile: string;
  quality_preset: string;
  created_at: string;
  updated_at: string;
  thumbnail_path?: string | null;
}

export interface ProjectCreatePayload {
  name: string;
  model_url: string;
  model_id?: number | null;
  model_name?: string | null;
  regions?: unknown[];
  paint_data?: Record<string, unknown>;
  modules?: unknown[];
  volume_regions?: unknown[];
  surface_regions?: unknown[];
  process_rules?: unknown[];
  surface_paint_grid?: Record<string, unknown> | null;
  surface_direction?: [number, number, number] | null;
  grid_magnetization?: Record<string, unknown> | null;
  input_type?: string | null;
  source_file?: Record<string, unknown> | null;
  gcode_info?: Record<string, unknown> | null;
  step?: string;
  split_result?: Record<string, unknown> | null;
  model_result?: Record<string, unknown> | null;
  slice_result?: Record<string, unknown> | null;
  gcode_result?: Record<string, unknown> | null;
  printer_profile?: string;
  quality_preset?: string;
}

export const createProject = async (data: ProjectCreatePayload): Promise<ProjectData> => {
  const response = await apiClient.post('/projects/', data);
  return response.data as ProjectData;
};

export const listProjects = async (): Promise<ProjectData[]> => {
  const response = await apiClient.get('/projects/');
  return response.data as ProjectData[];
};

export const getProject = async (projectId: string): Promise<ProjectData> => {
  const response = await apiClient.get(`/projects/${projectId}`);
  return response.data as ProjectData;
};

export const updateProject = async (
  projectId: string,
  data: Partial<ProjectCreatePayload>,
): Promise<ProjectData> => {
  const response = await apiClient.put(`/projects/${projectId}`, data);
  return response.data as ProjectData;
};

export const deleteProject = async (projectId: string) => {
  const response = await apiClient.delete(`/projects/${projectId}`);
  return response.data as { success: boolean; message: string };
};

// ========== Admin API ==========

export interface AdminStats {
  users: number;
  admins: number;
  models: number;
  projects: number;
  gcode_files: number;
  comments: number;
  print_history: number;
}

export interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  avatar_path: string | null;
  model_count: number;
  project_count: number;
  created_at: string;
}

export interface AdminModelRow {
  id: number;
  name: string;
  category: string | null;
  user_id: number | null;
  author: string | null;
  downloads: number;
  likes: number;
  created_at: string;
}

export interface AdminProjectRow {
  id: string;
  name: string;
  user_id: number;
  author: string | null;
  model_name: string | null;
  step: string;
  created_at: string;
  updated_at: string;
}

export interface AdminReportRow {
  id: number;
  model_id: number;
  model_name: string | null;
  reporter_id: number;
  reporter: string | null;
  reason: string;
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'resolved';
  created_at: string | null;
  reviewed_at: string | null;
}

export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await apiClient.get('/admin/stats');
  return response.data as AdminStats;
};

export const getAdminUsers = async (): Promise<AdminUserRow[]> => {
  const response = await apiClient.get('/admin/users');
  return response.data as AdminUserRow[];
};

export const deleteAdminUser = async (userId: number) => {
  const response = await apiClient.delete(`/admin/users/${userId}`);
  return response.data as { success: boolean; message: string };
};

export const getAdminModels = async (): Promise<AdminModelRow[]> => {
  const response = await apiClient.get('/admin/models');
  return response.data as AdminModelRow[];
};

export const deleteAdminModel = async (modelId: number) => {
  const response = await apiClient.delete(`/admin/models/${modelId}`);
  return response.data as { success: boolean; message: string };
};

export const getAdminProjects = async (): Promise<AdminProjectRow[]> => {
  const response = await apiClient.get('/admin/projects');
  return response.data as AdminProjectRow[];
};

export const deleteAdminProject = async (projectId: string) => {
  const response = await apiClient.delete(`/admin/projects/${projectId}`);
  return response.data as { success: boolean; message: string };
};

export const getAdminReports = async (status?: AdminReportRow['status']): Promise<AdminReportRow[]> => {
  const response = await apiClient.get('/community/admin/reports', { params: status ? { status } : undefined });
  return (response.data?.reports ?? []) as AdminReportRow[];
};

export const updateAdminReportStatus = async (reportId: number, status: AdminReportRow['status']) => {
  const response = await apiClient.put(`/community/admin/reports/${reportId}`, null, { params: { status } });
  return response.data;
};

export default apiClient;
