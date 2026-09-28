/** Скачивание файла из браузера. */
export const saveBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/** Текстовый файл: строка → Blob → ссылка. */
export const saveFile = (name: string, content: string, type: string) => saveBlob(name, new Blob([content], { type }));
