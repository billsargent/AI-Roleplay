/**
 * ─── Image Utility — File to Base64 ───
 *
 * Converts a File object (e.g., from an <input type="file">)
 * into a base64 data URL string for inline storage.
 *
 * Used by PersonaManager and CreateScenario for avatar/character image uploads.
 * Storing as base64 avoids needing a separate file server; images persist
 * in the database alongside the entity they belong to.
 *
 * @param file - The File object selected by the user
 * @returns A Promise resolving to a base64 data URL string (e.g., "data:image/png;base64,...")
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};
