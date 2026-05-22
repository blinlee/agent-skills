import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function ok(message) {
  console.log(`OK   ${message}`);
}

function warn(message) {
  console.log(`WARN ${message}`);
}

function fail(message) {
  console.log(`FAIL ${message}`);
}

async function fileExists(relPath) {
  try {
    await access(path.join(root, relPath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relPath) {
  return JSON.parse(await readFile(path.join(root, relPath), 'utf8'));
}

async function getGitDiffNameOnly(relPaths) {
  const { stdout } = await execFile('git', ['diff', '--name-only', '--', ...relPaths], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function getGitStatusShort(relPaths) {
  const { stdout } = await execFile('git', ['status', '--short', '--', ...relPaths], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function main() {
  let failed = false;

  const requiredFiles = [
    'SKILL.md',
    'README.md',
    'README.zh-CN.md',
    'scripts/build-prompt.mjs',
    'scripts/compose-templates.mjs',
    'scripts/template-brief.mjs',
    'scripts/check-mode.js',
    'scripts/run-codex-render.mjs',
    '.dev/tests/run-checks.mjs',
    '.dev/tests/golden-cases.json',
    'data/template-composer-profiles.json',
    'data/retrieval-index.json',
    'data/template-crosswalk.json',
    '.gitignore',
  ];

  for (const rel of requiredFiles) {
    if (await fileExists(rel)) ok(`required file exists: ${rel}`);
    else {
      fail(`missing required file: ${rel}`);
      failed = true;
    }
  }

  const profiles = await readJson('data/template-composer-profiles.json');
  const missingTargets = [];
  for (const profile of profiles.profiles || []) {
    if (!(await fileExists(profile.target))) missingTargets.push(profile.target);
  }
  if (missingTargets.length) {
    fail(`composer profiles point to missing targets: ${missingTargets.join(', ')}`);
    failed = true;
  } else {
    ok(`all composer profile targets exist (${(profiles.profiles || []).length})`);
  }

  const skillMd = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  if (/composer-first\s*\+\s*.+selector|不再作为 build-prompt 兼容入口/u.test(skillMd)) {
    warn('SKILL.md still contains retired selector wording; align docs with routing-brief-first behavior');
  } else {
    ok('SKILL.md describes current routing-brief-first behavior');
  }

  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  if (/composer-first\s*\+\s*.+selector/i.test(readme)) {
    warn('README.md still contains retired selector wording');
  } else {
    ok('README.md avoids retired selector wording');
  }

  const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
  if (/^img-gen-pro\/$/m.test(gitignore)) ok('.gitignore ignores runtime render artifacts');
  else {
    fail('.gitignore missing img-gen-pro/ ignore rule');
    failed = true;
  }
  if (/^\.dev\/tmp\/$/m.test(gitignore)) ok('.gitignore ignores local tmp test artifacts');
  else {
    fail('.gitignore missing .dev/tmp/ ignore rule');
    failed = true;
  }

  const dirtyPromptEngine = await getGitDiffNameOnly([
    'data/prompt-engine',
    'scripts/prompt-routing-config-source.mjs',
  ]);
  if (dirtyPromptEngine.length) {
    warn(`prompt-engine or routing sources are dirty: ${dirtyPromptEngine.join(', ')}`);
  } else {
    ok('prompt-engine and routing source tree are clean');
  }

  const status = await getGitStatusShort(['.']);
  if (status.length) warn(`working tree has pending img-gen-pro changes: ${status.join(' | ')}`);
  else ok('img-gen-pro working tree is clean');

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
