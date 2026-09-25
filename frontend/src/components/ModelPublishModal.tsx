import React, { useCallback, useEffect, useRef, useState } from 'react';
import { retainModel, uploadModel, type ModelData } from '../services/api';
import { getFileExtension, getFileName } from '../utils/path';

export interface ModelPublishPreset {
  modelId?: number | null;
  modelName?: string;
  modelUrl?: string;
  sourceLabel?: string;
}

interface CategoryOption {
  key: string;
  name: string;
}

interface ModelPublishModalProps {
  mode: 'upload' | 'retain';
  title?: string;
  subtitle?: string;
  preset?: ModelPublishPreset;
  categories: CategoryOption[];
  requirements: string[];
  onClose: () => void;
  onPublished: (model: ModelData) => void;
}

const IconCube = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="M12 12 4 7.5" />
    <path d="m12 12 8-4.5" />
    <path d="M12 12v9" />
  </svg>
);

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

const ModelPublishModal: React.FC<ModelPublishModalProps> = ({
  mode,
  title,
  subtitle,
  preset,
  categories,
  requirements,
  onClose,
  onPublished,
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState(stripExtension(preset?.modelName || ''));
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadCategory, setUploadCategory] = useState(categories.find((category) => category.key !== 'all')?.key || 'home');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadThumb, setUploadThumb] = useState<File | null>(null);
  const [uploadThumbPreview, setUploadThumbPreview] = useState<string | null>(null);
  const [uploadThumbStatus, setUploadThumbStatus] = useState('');
  const [uploadThumbGenerated, setUploadThumbGenerated] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const thumbPreviewUrlRef = useRef<string | null>(null);
  const thumbnailJobRef = useRef(0);
  const retainThumbnailSourceRef = useRef<string | null>(null);
  const overlayPointerStartedRef = useRef(false);

  const replaceThumbPreviewUrl = useCallback((nextUrl: string | null) => {
    if (thumbPreviewUrlRef.current) {
      URL.revokeObjectURL(thumbPreviewUrlRef.current);
      thumbPreviewUrlRef.current = null;
    }
    thumbPreviewUrlRef.current = nextUrl;
    setUploadThumbPreview(nextUrl);
  }, []);

  useEffect(() => () => {
    if (thumbPreviewUrlRef.current) {
      URL.revokeObjectURL(thumbPreviewUrlRef.current);
      thumbPreviewUrlRef.current = null;
    }
  }, []);

  const createDefaultUploadThumbnail = useCallback(async (file: File) => {
    const jobId = thumbnailJobRef.current + 1;
    thumbnailJobRef.current = jobId;
    setUploadThumbStatus('正在生成正面预览...');
    setUploadThumbGenerated(false);
    replaceThumbPreviewUrl(null);
    try {
      const { generateModelThumbnail } = await import('../utils/modelThumbnail');
      const result = await generateModelThumbnail(file);
      if (thumbnailJobRef.current !== jobId) {
        URL.revokeObjectURL(result.previewUrl);
        return;
      }
      setUploadThumb(result.file);
      setUploadThumbGenerated(true);
      replaceThumbPreviewUrl(result.previewUrl);
      setUploadThumbStatus(result.generatedFromModel ? '已生成正面默认缩略图' : '该格式暂不能本地渲染，已生成默认封面');
    } catch {
      if (thumbnailJobRef.current === jobId) {
        setUploadThumb(null);
        setUploadThumbGenerated(false);
        replaceThumbPreviewUrl(null);
        setUploadThumbStatus('缩略图生成失败，可手动选择图片');
      }
    }
  }, [replaceThumbPreviewUrl]);

  useEffect(() => {
    if (mode !== 'retain' || !preset?.modelUrl || uploadThumb || uploadThumbGenerated) return;
    if (retainThumbnailSourceRef.current === preset.modelUrl) return;
    let cancelled = false;
    const jobId = thumbnailJobRef.current + 1;
    thumbnailJobRef.current = jobId;
    retainThumbnailSourceRef.current = preset.modelUrl;
    setUploadThumbStatus('正在读取模型并生成预览...');
    setUploadThumbGenerated(false);
    replaceThumbPreviewUrl(null);

    const createRetainedModelThumbnail = async () => {
      try {
        const response = await fetch(preset.modelUrl!);
        if (!response.ok) throw new Error(`Model fetch failed: ${response.status}`);
        const blob = await response.blob();
        if (cancelled || thumbnailJobRef.current !== jobId) return;
        const fallbackName = preset.modelName || getFileName(preset.modelUrl!) || 'AI 创作模型';
        const ext = getFileExtension(preset.modelUrl!);
        const modelFileName = ext && !fallbackName.toLowerCase().endsWith(`.${ext}`)
          ? `${fallbackName}.${ext}`
          : fallbackName;
        const modelFile = new File([blob], modelFileName, { type: blob.type || 'application/octet-stream' });
        await createDefaultUploadThumbnail(modelFile);
      } catch {
        if (!cancelled && thumbnailJobRef.current === jobId) {
          setUploadThumb(null);
          setUploadThumbGenerated(false);
          replaceThumbPreviewUrl(null);
          setUploadThumbStatus('缩略图生成失败，可手动选择图片');
        }
      }
    };

    void createRetainedModelThumbnail();
    return () => {
      cancelled = true;
    };
  }, [createDefaultUploadThumbnail, mode, preset?.modelName, preset?.modelUrl, replaceThumbPreviewUrl, uploadThumb, uploadThumbGenerated]);

  const handleSubmit = async () => {
    const name = uploadName.trim() || stripExtension(preset?.modelName || '') || 'AI 创作模型';
    if (mode === 'upload' && !uploadFile) return;
    if (mode === 'retain' && !preset?.modelId) return;
    setUploading(true);
    try {
      const published = mode === 'retain'
        ? await retainModel(preset!.modelId!, name, uploadDesc.trim() || undefined, uploadCategory, uploadThumb || undefined)
        : await uploadModel(uploadFile!, name, uploadDesc.trim() || undefined, uploadCategory, uploadThumb || undefined);
      onPublished(published);
    } finally {
      setUploading(false);
    }
  };

  const submitDisabled = uploading || !uploadName.trim() || (mode === 'upload' ? !uploadFile : !preset?.modelId);
  const selectedFileLabel = mode === 'retain'
    ? (preset?.modelName || '当前生成模型')
    : (uploadFile ? uploadFile.name : '请选择模型文件并填写名称');

  return (
    <div
      className="market-upload-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || (mode === 'retain' ? '发布模型' : '上传模型')}
      onPointerDown={(event) => {
        overlayPointerStartedRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (overlayPointerStartedRef.current && event.target === event.currentTarget) {
          onClose();
        }
        overlayPointerStartedRef.current = false;
      }}
      onPointerCancel={() => {
        overlayPointerStartedRef.current = false;
      }}
    >
      <div className="market-upload-modal">
        <div className="market-upload-modal-head">
          <div>
            <h2>{title || (mode === 'retain' ? '发布模型' : '上传模型')}</h2>
            <p>{subtitle || '添加模型文件、展示信息和默认缩略图'}</p>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="market-upload-body">
          <section className="market-upload-section market-upload-section--file" aria-label="模型文件">
            <div className="market-upload-section-head">
              <span>01</span>
              <div>
                <strong>模型文件</strong>
                <p>{mode === 'retain' ? '已选定当前生成后的模型' : '先选择文件，系统会立即尝试生成正面缩略图'}</p>
              </div>
            </div>
            {mode === 'retain' ? (
              <div className="market-upload-drop market-upload-drop--locked">
                <strong>{preset?.modelName || '当前生成模型'}</strong>
                <span>{preset?.sourceLabel || '来自 AI 创作结果'}</span>
              </div>
            ) : (
              <label className="market-upload-drop">
                <input
                  type="file"
                  accept=".glb,.gltf,.obj,.stl,.3mf,.step"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploadFile(file);
                    if (!uploadName) setUploadName(stripExtension(file.name));
                    createDefaultUploadThumbnail(file);
                  }}
                />
                <strong>{uploadFile ? uploadFile.name : '选择模型文件'}</strong>
                <span>支持 GLB、GLTF、OBJ、STL、3MF、STEP</span>
              </label>
            )}
          </section>

          <section className="market-upload-section market-upload-section--info" aria-label="模型信息">
            <div className="market-upload-section-head">
              <span>02</span>
              <div>
                <strong>模型信息</strong>
                <p>保持简短明确，便于在模型库中浏览</p>
              </div>
            </div>
            <div className="market-upload-form-grid">
              <label className="market-upload-field">
                <span>模型名称 *</span>
                <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="给模型起一个名称" />
              </label>

              <label className="market-upload-field">
                <span>分类</span>
                <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
                  {categories.filter((category) => category.key !== 'all').map((category) => (
                    <option key={category.key} value={category.key}>{category.name}</option>
                  ))}
                  <option value="other">其他</option>
                </select>
              </label>
            </div>

            <label className="market-upload-field">
              <span>描述</span>
              <textarea value={uploadDesc} onChange={(event) => setUploadDesc(event.target.value)} placeholder="介绍模型用途、打印建议或组装说明" rows={3} />
            </label>
          </section>

          <section className="market-upload-section market-upload-section--thumb" aria-label="模型缩略图">
            <div className="market-upload-section-head">
              <span>03</span>
              <div>
                <strong>展示缩略图</strong>
                <p>{mode === 'upload' || preset?.modelUrl ? '自动生成的正面图会作为默认封面，可手动替换' : '可手动选择一张图片作为发布封面'}</p>
              </div>
            </div>
            <div className="market-upload-thumb">
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  thumbnailJobRef.current += 1;
                  setUploadThumb(file);
                  setUploadThumbGenerated(false);
                  if (file) {
                    replaceThumbPreviewUrl(URL.createObjectURL(file));
                    setUploadThumbStatus('已使用手动选择的缩略图');
                  } else {
                    replaceThumbPreviewUrl(null);
                    setUploadThumbStatus('');
                  }
                }}
              />
              <div className="market-upload-thumb-preview">
                {uploadThumbPreview ? (
                  <img src={uploadThumbPreview} alt="模型正面缩略图预览" />
                ) : (
                  <div>
                    <IconCube />
                    <span>{(mode === 'upload' && uploadFile) || (mode === 'retain' && preset?.modelUrl) ? '等待生成预览' : '可手动选择封面'}</span>
                  </div>
                )}
              </div>
              <div className="market-upload-thumb-copy">
                <button type="button" onClick={() => thumbInputRef.current?.click()}>
                  {uploadThumb && !uploadThumbGenerated ? uploadThumb.name : '手动替换缩略图'}
                </button>
                <span>{uploadThumbStatus || (mode === 'upload' || preset?.modelUrl ? '发布时会先生成一个默认正面图' : '未选择时使用模型默认封面')}</span>
              </div>
            </div>
          </section>

          <section className="market-upload-requirements" aria-label="发布质量要求">
            <div>
              <strong>发布前检查</strong>
              <span>参考模型社区的展示与打印配置要求</span>
            </div>
            <ul className="market-upload-checklist">
              {requirements.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </div>

        <div className="market-upload-actions">
          <div>
            <strong>{mode === 'retain' || uploadFile ? '准备发布' : '等待选择模型'}</strong>
            <span>{selectedFileLabel}</span>
          </div>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" disabled={submitDisabled} onClick={handleSubmit}>
              {uploading ? '发布中...' : mode === 'retain' ? '发布并永久保留' : '上传'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelPublishModal;
