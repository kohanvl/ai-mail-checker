#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

async function copyDir(src, dest, {transform} = {}) {
  await fs.mkdir(dest, {recursive: true});
  const entries = await fs.readdir(src, {withFileTypes: true});
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, {transform});
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destPath), {recursive: true});
        if (transform) {
          await transform(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }),
  );
}

async function minifyJsFile(srcPath, destPath) {
  await fs.copyFile(srcPath, destPath);
}

async function minifyCssFile(srcPath, destPath) {
  await fs.copyFile(srcPath, destPath);
}

async function minifyJsonFile(srcPath, destPath) {
  await fs.copyFile(srcPath, destPath);
}

async function minifyHtmlFile(srcPath, destPath) {
  await fs.copyFile(srcPath, destPath);
}

async function transformStaticAsset(srcPath, destPath) {
  const ext = path.extname(srcPath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    await minifyJsFile(srcPath, destPath);
  } else if (ext === '.css') {
    await minifyCssFile(srcPath, destPath);
  } else if (ext === '.html' || ext === '.htm') {
    await minifyHtmlFile(srcPath, destPath);
  } else if (ext === '.json') {
    await minifyJsonFile(srcPath, destPath);
  } else {
    await fs.copyFile(srcPath, destPath);
  }
}

async function writePackageJson() {
  const pkgPath = path.join(root, 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  if (pkg.scripts) {
    const {build, ...rest} = pkg.scripts;
    pkg.scripts = rest;
  }
  const distPkgPath = path.join(dist, 'package.json');
  await fs.writeFile(distPkgPath, JSON.stringify(pkg, null, 2));
}

async function main() {
  await fs.rm(dist, {recursive: true, force: true});
  await fs.mkdir(dist, {recursive: true});

  await copyDir(path.join(root, 'src'), path.join(dist, 'src'));
  await copyDir(path.join(root, 'public'), path.join(dist, 'public'), {
    transform: transformStaticAsset,
  });

  const files = ['index.js', 'template.html', 'package-lock.json'];
  for (const file of files) {
    const srcPath = path.join(root, file);
    try {
      const destPath = path.join(dist, file);
      await fs.mkdir(path.dirname(destPath), {recursive: true});
      if (file.endsWith('.html')) {
        await minifyHtmlFile(srcPath, destPath);
      } else if (file.endsWith('.json')) {
        await minifyJsonFile(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  await writePackageJson();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
