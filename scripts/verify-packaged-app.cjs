const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { developmentMarkers } = require('./verify-production-build.cjs');

const fromBuilder = createRequire(require.resolve('electron-builder/package.json'));
const requirePackager = createRequire(fromBuilder.resolve('app-builder-lib/package.json'));
const asar = requirePackager('@electron/asar');

const renderer = 'out/renderer/';
const staticAssets = renderer + 'assets/';
const requiredGraphics = [
  { source: 'assets/bg/library-starry.png', name: /^library-starry-[\w-]+\.png$/ },
  { source: 'assets/ui/constellation.svg', name: /^constellation-[\w-]+\.svg$/ },
  // Premium finish paper grain (DESIGN.md §10.1); a file rather than a data: URL, which the CSP blocks.
  { source: 'assets/ui/paper-grain.svg', name: /^paper-grain-[\w-]+\.svg$/ },
  // Prismatic crystal: the mask that cuts the central table out of the refraction ring (DESIGN.md §6.5; M5h).
  { source: 'assets/ui/crystal-ring-mask.svg', name: /^crystal-ring-mask-[\w-]+\.svg$/ },
  // Meeting card coil binding (DESIGN.md §5.13; Hagemi M6 sketch, M6b): a file, not a data: URL.
  { source: 'assets/ui/meeting-coil.svg', name: /^meeting-coil-[\w-]+\.svg$/ },
];
const fontFamilies = ['noto-serif-tc', 'noto-sans-tc', 'jetbrains-mono'];
const requiredEntries = ['package.json', 'out/main/index.js', 'out/preload/index.js', renderer + 'index.html'];
const iconSizes = [16, 24, 32, 48, 64, 128, 256];

function archiveFiles({ files }, directory = '') {
  return Object.entries(files).flatMap(([name, item]) => {
    const key = directory + name;
    return item.files ? archiveFiles(item, key + '/') : [{ key, ...item }];
  });
}

function inspectPayload(appDir, projectDir) {
  const resources = path.join(appDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  const read = (key) => asar.extractFile(archive, path.normalize(key));
  const entries = archiveFiles(asar.getRawHeader(archive).header);
  const keys = new Set(entries.map(({ key }) => key));
  const problems = [];
  const graphics = [];
  const fonts = {};
  for (const name of fs.readdirSync(resources)) {
    if (!['app.asar', 'licenses', 'elevate.exe'].includes(name)) {
      problems.push('不應隨正式版分發的 resources 項目 ' + name);
    }
  }
  for (const key of requiredEntries) {
    if (!keys.has(key)) problems.push('缺少 ASAR 入口 ' + key);
  }
  for (const { key, link, unpacked } of entries) {
    if (!key.startsWith('node_modules/') && !key.startsWith('out/') && key !== 'package.json') {
      problems.push('ASAR 收錄了非建置檔案 ' + key);
    }
    if (!key.startsWith('out/')) continue;
    if (link || unpacked || /(?:^|\/)(?:fixtures|tests?|docs)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i.test(key)) {
      problems.push('建置檔不應位於此位置或以連結提供 ' + key);
      continue;
    }
    if (!requiredEntries.includes(key) && (!key.startsWith(staticAssets) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css|png|svg|woff2?)$/.test(key.slice(staticAssets.length)))) {
      problems.push('正式版協定不會提供此建置檔 ' + key);
      continue;
    }
    if (/\.(?:js|html|css)$/.test(key)) {
      const code = read(key).toString('utf8');
      for (const marker of developmentMarkers) {
        if (code.includes(marker)) problems.push(key + ' 含開發模式標記 ' + marker);
      }
      if (key.startsWith(renderer)) {
        for (const [, asset] of code.matchAll(/(?:^|[/"'(])assets\/([a-z0-9][a-z0-9._-]*\.(?:js|css|png|svg|woff2?))(?=["') ])/gi)) {
          if (!keys.has(staticAssets + asset)) problems.push(key + ' 引用缺少的資源 ' + asset);
        }
      }
    } else if (/\.(?:png|svg)$/.test(key) && !requiredGraphics.some(({ name }) => name.test(path.posix.basename(key)))) {
      problems.push('未列入正式介面的圖像 ' + key);
    } else if (/\.woff2?$/.test(key) && !fontFamilies.some((family) => path.posix.basename(key).startsWith(family + '-'))) {
      problems.push('未列入正式介面的字型 ' + key);
    }
  }

  for (const { source, name } of requiredGraphics) {
    const matches = [...keys].filter((key) => key.startsWith(staticAssets) && name.test(path.posix.basename(key)));
    if (matches.length !== 1) {
      problems.push('應有一份 Vite 圖像 ' + source);
    } else if (!read(matches[0]).equals(fs.readFileSync(path.join(projectDir, source)))) {
      problems.push('圖像與 repo 素材不符 ' + matches[0]);
    } else {
      graphics.push(matches[0]);
    }
  }
  for (const family of fontFamilies) {
    const matches = [...keys].filter((key) => key.startsWith(staticAssets + family + '-') && /\.woff2?$/.test(key));
    fonts[family] = matches.length;
    if (!matches.length) problems.push('缺少字型 ' + family);
    for (const key of matches) {
      const expected = key.endsWith('.woff2') ? 'wOF2' : 'wOFF';
      if (read(key).toString('ascii', 0, 4) !== expected) problems.push('無效的字型檔 ' + key);
    }
    const license = path.join(resources, 'licenses', family + '.txt');
    const original = path.join(projectDir, 'node_modules', '@fontsource-variable', family, 'LICENSE');
    if (!fs.existsSync(license) || !fs.readFileSync(license).equals(fs.readFileSync(original))) {
      problems.push('缺少或改動了字型授權 ' + family);
    }
  }
  const manifest = keys.has('package.json') ? JSON.parse(read('package.json').toString('utf8')) : null;
  if (manifest && manifest.main !== './out/main/index.js') problems.push('ASAR package.json 的 main 不是正式入口');
  return { problems, archive, entries: entries.length, fonts, graphics, version: manifest?.version };
}

function assertPayload(appDir, projectDir) {
  const result = inspectPayload(appDir, projectDir);
  if (result.problems.length) throw Error(result.problems.join('\n'));
  return result;
}

function verifyWindowsIcon(appDir, projectDir) {
  const { Data, NtExecutable, NtExecutableResource, Resource } = requirePackager('resedit');
  const ico = Data.IconFile.from(fs.readFileSync(path.join(projectDir, 'assets/icon/app.ico')));
  const originalSizes = ico.icons.map(({ data, width, height }) => [width || data.width, height || data.height]
    .map((side) => side === 0 ? 256 : Math.abs(side)));
  const exeName = fs.readdirSync(appDir).find((file) => /\.exe$/i.test(file));
  if (!exeName) throw Error('找不到 Windows EXE');
  const exe = NtExecutable.from(fs.readFileSync(path.join(appDir, exeName)), { ignoreCert: true });
  const resource = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(resource.entries);
  const iconShape = (sizes) => sizes.map(([w, h]) => w + 'x' + h).sort().join(',');
  const expected = iconShape(iconSizes.map((size) => [size, size]));
  if (iconShape(originalSizes) !== expected) throw Error('app.ico 的圖示尺寸不齊全');
  const group = groups.find(({ icons }) => iconShape(icons.map(({ width, height }) =>
    [width || 256, height || 256])) === expected);
  if (!group || group.getIconItemsFromEntries(resource.entries).length !== iconSizes.length) throw Error('EXE 沒有嵌入完整的七層圖示');
  const { ProductName, ProductVersion } = Resource.VersionInfo.fromEntries(resource.entries)
    .flatMap((version) => version.getAllLanguagesForStringValues().map((language) => version.getStringValues(language)))
    .find((values) => values.ProductName && values.ProductVersion) ?? {};
  if (!ProductName || !ProductVersion) throw Error('EXE 缺少 Windows 產品中繼資料');
  return { exeName, iconSizes, ProductName, ProductVersion };
}

module.exports = { inspectPayload, assertPayload, verifyWindowsIcon };
module.exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') assertPayload(context.appOutDir, context.packager.projectDir);
};

if (require.main === module) {
  try {
    const projectDir = path.resolve(__dirname, '..');
    const appDir = path.resolve(process.argv[2] || 'release/win-unpacked');
    const { archive, entries, fonts, graphics, version } = assertPayload(appDir, projectDir);
    const windows = verifyWindowsIcon(appDir, projectDir);
    if (windows.ProductVersion !== version && windows.ProductVersion !== version + '.0') {
      throw Error('EXE ProductVersion 和 ASAR package.json 不符');
    }
    console.log(JSON.stringify({ entries, asarBytes: fs.statSync(archive).size, version, graphics, fonts, ...windows }, null, 2));
  } catch (error) {
    console.error('打包產物檢查失敗：' + error.message);
    process.exitCode = 1;
  }
}
