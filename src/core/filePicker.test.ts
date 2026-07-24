import { describe, expect, it, afterEach, vi } from 'vitest';
import { getFilePicker, pickImportFiles, reacquireFile } from './filePicker';

describe('filePicker', () => {
  afterEach(() => {
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  it('getFilePicker returns null cand browserul nu suporta File System Access API', () => {
    expect(getFilePicker()).toBeNull();
  });

  it('getFilePicker returneaza functia cand e prezenta pe window', () => {
    const fn = vi.fn();
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = fn;
    expect(getFilePicker()).toBeTypeOf('function');
  });

  it('pickImportFiles intoarce null cand API-ul lipseste (apelantul trebuie sa cada pe <input type="file">)', async () => {
    expect(await pickImportFiles()).toBeNull();
  });

  it('pickImportFiles intoarce liste goale (nu arunca) cand utilizatorul inchide selectorul (AbortError)', async () => {
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(() =>
      Promise.reject(new DOMException('cancelled', 'AbortError'))
    );
    const result = await pickImportFiles();
    expect(result).toEqual({ files: [], handles: [] });
  });

  it('pickImportFiles intoarce null (nu arunca) daca API-ul exista dar esueaza la apel (ex. SecurityError intr-un context restrictionat)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(() =>
      Promise.reject(new DOMException('blocked', 'SecurityError'))
    );
    const result = await pickImportFiles();
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it('pickImportFiles citeste File-urile din handle-urile alese', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const handle = { getFile: vi.fn().mockResolvedValue(file) };
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
    const result = await pickImportFiles();
    expect(result?.files).toEqual([file]);
    expect(result?.handles).toEqual([handle]);
  });

  it('reacquireFile citeste direct fisierul cand nu exista queryPermission (browser fara suport pentru verificare)', async () => {
    const file = new File(['x'], 'a.jpg');
    const handle = { getFile: vi.fn().mockResolvedValue(file) };
    expect(await reacquireFile(handle)).toBe(file);
  });

  it('reacquireFile cere permisiunea din nou daca a fost revocata, si citeste fisierul dupa acordare', async () => {
    const file = new File(['x'], 'a.jpg');
    const handle = {
      getFile: vi.fn().mockResolvedValue(file),
      queryPermission: vi.fn().mockResolvedValue('prompt' as const),
      requestPermission: vi.fn().mockResolvedValue('granted' as const)
    };
    expect(await reacquireFile(handle)).toBe(file);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('reacquireFile arunca daca permisiunea e refuzata explicit', async () => {
    const handle = {
      getFile: vi.fn(),
      queryPermission: vi.fn().mockResolvedValue('denied' as const),
      requestPermission: vi.fn().mockResolvedValue('denied' as const)
    };
    await expect(reacquireFile(handle)).rejects.toThrow();
    expect(handle.getFile).not.toHaveBeenCalled();
  });
});
