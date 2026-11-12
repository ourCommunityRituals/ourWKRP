// Integration verdict on a seeded run: every station's report answered 200,
// every scan was counted, and each total equals the scans sent less the hours
// under the floor (the medium shape sends 30 and must report 27).
//   node showcase/tests/integration/check-reports.mjs <slug>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHAPES, scansFor, expectedTotal } from '../../lib/showcase.mjs';
import { SHOWCASE, readJson, publishProblems, publishedTexts } from '../../lib/build.mjs';

export function reportProblems(creator, data) {
  const problems = [];
  const events = creator.stations.filter((s) => s.event);
  for (const st of events) {
    const r = data.reports.find((x) => x.station === st.id);
    if (!r) {
      problems.push(`${st.id}: no report`);
      continue;
    }
    const shape = SHAPES[st.event.demo];
    if (r.reportStatus !== 200) problems.push(`${st.id}: report answered ${r.reportStatus}`);
    if (r.scansSent !== scansFor(shape)) problems.push(`${st.id}: ${r.scansSent} of ${scansFor(shape)} scans counted`);
    if (r.distinctScanners !== expectedTotal(shape)) problems.push(`${st.id}: report total ${r.distinctScanners}, expected ${expectedTotal(shape)}`);
    // Never who, on the real captured report page too.
    if (typeof r.pageText === 'string') problems.push(...publishProblems(`${st.id} report page`, r.pageText));
    if (Array.isArray(r.pageErrors) && r.pageErrors.length) problems.push(`${st.id}: report page errors: ${r.pageErrors.join('; ')}`);
  }
  if (data.reports.length !== events.length) problems.push(`${data.reports.length} reports for ${events.length} events`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const slug = process.argv[2];
  const creator = readJson(join(SHOWCASE, 'fixtures', `${slug}.json`));
  const data = readJson(join(SHOWCASE, 'work', slug, 'reports.json'));
  const problems = reportProblems(creator, data);
  // The folder that would be published: no signed link, key, token or identity.
  const outDir = join(SHOWCASE, 'out', slug);
  for (const [p, text] of publishedTexts(outDir)) problems.push(...publishProblems(p.slice(outDir.length + 1), text));
  const images = data.reports.flatMap((r) => Object.values(r.images ?? {}));
  if (images.length !== data.reports.length * 3) problems.push(`${images.length} captured images for ${data.reports.length} reports`);
  for (const r of data.reports) console.log(`${r.station}: status ${r.reportStatus}, sent ${r.scansSent}, total ${r.distinctScanners}`);
  if (problems.length) {
    console.error(`::error::showcase integration failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('showcase integration: every report answered and every total matches its shape');
}
