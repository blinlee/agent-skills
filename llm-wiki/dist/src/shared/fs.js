import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function exists(targetPath) {
    try {
        await access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
export async function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}
export async function writeJsonFile(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export async function ensureJsonFile(filePath, initialValue) {
    await mkdir(path.dirname(filePath), { recursive: true });
    if (await exists(filePath)) {
        return;
    }
    await writeJsonFile(filePath, initialValue);
}
