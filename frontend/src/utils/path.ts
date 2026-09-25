export const getFileName = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').split('?')[0].split('#')[0];
  return normalized.split('/').pop() || value;
};

export const getFileExtension = (value: string): string => {
  const fileName = getFileName(value);
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return /^[a-z0-9]+$/.test(extension) ? extension : '';
};

export const getFilePathSegment = (value: string): string => {
  const fileName = getFileName(value);
  try {
    return encodeURIComponent(decodeURIComponent(fileName));
  } catch {
    return encodeURIComponent(fileName);
  }
};
