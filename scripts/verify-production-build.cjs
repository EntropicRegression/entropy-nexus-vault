// Refuses to package a build that is not a clean production build (docs/架構.md §1, M5b review S7).
// Used by `npm run dist` and by electron-builder's beforePack hook, so a direct `electron-builder` run is checked too.
const fs = require('node:fs');
const path = require('node:path');

/** Markers that exist only in development-mode builds (src/renderer/app/accept-clock.ts). */
const developmentMarkers = ['__floorClock', 'createAcceptanceClock'];
const requiredEntries = ['main/index.js', 'preload/index.js', 'renderer/index.html'];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? filesUnder(full) : [full];
  });
}

/** Returns a list of problems; an empty list means the output may be packaged. */
function checkProductionBuild(outDir) {
  if (!fs.existsSync(outDir)) return ['找不到建置輸出:' + path.basename(outDir) + '(請先執行 npm run build)'];
  const problems = requiredEntries.filter((entry) => !fs.existsSync(path.join(outDir, entry)))
    .map((entry) => '建置輸出缺少 ' + entry);
  for (const file of filesUnder(outDir)) {
    if (!/\.(?:c?js|mjs|html)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of developmentMarkers) {
      if (text.includes(marker)) problems.push(path.relative(outDir, file) + ' 含開發模式標記 ' + marker);
    }
  }
  return problems;
}

function assertProductionBuild(outDir) {
  const problems = checkProductionBuild(outDir);
  if (problems.length) throw new Error('不能打包:這不是乾淨的正式建置。\n- ' + problems.join('\n- '));
}

module.exports = { checkProductionBuild, assertProductionBuild, developmentMarkers };

// electron-builder beforePack hook.
module.exports.default = async function beforePack(context) {
  assertProductionBuild(path.join(context.packager.projectDir, 'out'));
};

if (require.main === module) {
  try {
    assertProductionBuild(path.resolve(process.argv[2] || 'out'));
    console.log('正式建置檢查通過:沒有開發模式標記。');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
