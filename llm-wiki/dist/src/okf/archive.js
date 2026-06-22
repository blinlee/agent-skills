import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const TAR_BLOCK_SIZE = 512;
export async function createTarGzArchive(input) {
    const sourceDir = path.resolve(input.sourceDir);
    const archivePath = path.resolve(input.archivePath);
    const files = await listFiles(sourceDir, archivePath);
    const tarBlocks = [];
    for (const filePath of files) {
        const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, '/');
        const content = await readFile(filePath);
        const fileStat = await stat(filePath);
        tarBlocks.push(createTarHeader({
            path: relativePath,
            size: content.length,
            mtimeSeconds: Math.floor(fileStat.mtimeMs / 1000),
        }));
        tarBlocks.push(content);
        tarBlocks.push(Buffer.alloc(paddingLength(content.length)));
    }
    tarBlocks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, gzipSync(Buffer.concat(tarBlocks)));
    return {
        archivePath,
        fileCount: files.length,
    };
}
async function listFiles(sourceDir, archivePath) {
    const output = [];
    async function visit(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const entryPath = path.join(directory, entry.name);
            if (path.resolve(entryPath) === archivePath) {
                continue;
            }
            if (entry.isDirectory()) {
                await visit(entryPath);
            }
            else if (entry.isFile()) {
                output.push(entryPath);
            }
        }
    }
    await visit(sourceDir);
    return output;
}
function createTarHeader(input) {
    const header = Buffer.alloc(TAR_BLOCK_SIZE);
    const pathParts = splitTarPath(input.path);
    writeString(header, 0, 100, pathParts.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, input.size);
    writeOctal(header, 136, 12, input.mtimeSeconds);
    header.fill(0x20, 148, 156);
    header.write('0', 156, 'ascii');
    writeString(header, 257, 6, 'ustar');
    writeString(header, 263, 2, '00');
    writeString(header, 265, 32, 'llm-wiki');
    writeString(header, 297, 32, 'llm-wiki');
    if (pathParts.prefix) {
        writeString(header, 345, 155, pathParts.prefix);
    }
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeChecksum(header, checksum);
    return header;
}
function splitTarPath(value) {
    if (Buffer.byteLength(value) <= 100) {
        return { name: value, prefix: null };
    }
    const segments = value.split('/');
    for (let index = segments.length - 1; index > 0; index -= 1) {
        const prefix = segments.slice(0, index).join('/');
        const name = segments.slice(index).join('/');
        if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
            return { name, prefix };
        }
    }
    throw new Error(`OKF archive path is too long for portable tar format: ${value}`);
}
function writeString(buffer, offset, length, value) {
    const written = buffer.write(value, offset, length, 'utf8');
    if (written > length) {
        throw new Error(`Value is too long for tar header field: ${value}`);
    }
}
function writeOctal(buffer, offset, length, value) {
    const encoded = value.toString(8).padStart(length - 1, '0');
    buffer.write(encoded.slice(-length + 1), offset, length - 1, 'ascii');
    buffer[offset + length - 1] = 0;
}
function writeChecksum(buffer, checksum) {
    const encoded = checksum.toString(8).padStart(6, '0');
    buffer.write(encoded.slice(-6), 148, 6, 'ascii');
    buffer[154] = 0;
    buffer[155] = 0x20;
}
function paddingLength(size) {
    const remainder = size % TAR_BLOCK_SIZE;
    return remainder === 0 ? 0 : TAR_BLOCK_SIZE - remainder;
}
