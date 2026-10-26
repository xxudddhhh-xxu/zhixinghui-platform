/**
 * 修复 multipart 上传文件名的 mojibake:multer/busboy 在部分组合下会把
 * UTF-8 文件名按 latin1 解码(如 "项目指南" → "é¡¹ç›®æŒ‡å—")。
 * 尝试 latin1 → utf8 还原;仅当还原结果不含替换符且确实发生变化时采用,
 * 纯 ASCII 或本来就是正确 Unicode 的名字原样返回。
 */
export function sanitizeFilename(name: string): string {
  if (!name || /^[\x00-\x7f]*$/.test(name)) return name;
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8');
    if (restored !== name && !restored.includes('\ufffd')) return restored;
  } catch {
    /* fallthrough */
  }
  return name;
}
