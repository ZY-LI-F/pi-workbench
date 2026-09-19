import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function evidencePdf(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>", "",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [index, text] of [[3, "First page"], [5, "Scientific evidence page two"]] as const) {
    const stream = `BT /F1 22 Tf 50 700 Td (${text}) Tj ET`;
    objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let source = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

/** Deliberately synthetic files for deterministic reader acceptance; not a scientific reproduction. */
export async function createScientificArtifacts(project: string) {
  const pack = join(project, "阅读包");
  await mkdir(join(pack, "references"), { recursive: true }); await mkdir(join(pack, "assets")); await mkdir(join(pack, "src"));
  const paper = join(pack, "references", "paper.md"); const csv = join(pack, "assets", "表 #1.csv");
  const notebook = join(pack, "results.ipynb"); const report = join(pack, "verification.json"); const usage = join(pack, "USAGE.md");
  await writeFile(join(pack, "assets", "figure.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="160"><rect width="560" height="160" fill="#e4e9f5"/><text x="24" y="80" font-size="28">Saved scientific figure</text><script>window.unsafe=1</script></svg>');
  await writeFile(paper, '# Molecular evidence\n\n$x^2 + y^2 = z^2$\n\n![Saved figure](../assets/figure.svg)\n\n## Methods\n\n' + Array.from({ length: 24 }, (_, index) => `Evidence paragraph ${index + 1}. This is a synthetic reader fixture, not a reproduced scientific result.\n\n`).join("")
    + '## Results\n\n[数据表](../assets/%E8%A1%A8%20%231.csv)\n\n[原文第二页](../source.pdf#page=2)\n\n[无效页码](../source.pdf#page=99)\n\n[缺失证据](missing.md)\n\n[Notebook](../results.ipynb)\n\n[接口说明](../USAGE.md)\n\nFootnote[^1].\n\n[^1]: Synthetic evidence.\n');
  await writeFile(csv, 'id,value,note\n9007199254740993,2,"two, quoted"\n9007199254740992,10,=SUM(A1:A2)\n001,1,"line one\nline two"\n' + Array.from({ length: 110 }, (_, index) => `case-${index},${index + 20},additional row`).join("\n"));
  await writeFile(join(pack, "source.pdf"), evidencePdf());
  await writeFile(report, JSON.stringify({ status: "reviewed_with_limitations", mechanical_ok: true, issues: [], limitations: ["Synthetic fixture: no scientific reproduction"], artifact_checks: [{ file: "assets/表 #1.csv", matches_source_conversion: true }] }));
  await writeFile(usage, '# MCP usage (read only)\n\n[工具源码](src/server.py)\n\n[工具 Schema](schema.json)\n\nNo server is registered by viewing this file.');
  await writeFile(join(pack, "schema.json"), JSON.stringify({ tools: [{ name: "predict", inputSchema: { type: "object", properties: { smiles: { type: "string" } } } }] }));
  await writeFile(join(pack, "src", "server.py"), Array.from({ length: 240 }, (_, index) => `# line ${index + 1}`).join("\n") + '\nfrom pathlib import Path\nPath("DO_NOT_EXECUTE.txt").write_text("bad")\n');
  await writeFile(notebook, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: "python" } }, cells: [
    { cell_type: "markdown", source: '# Saved notebook\n\n$E = mc^2$\n\n![cell figure](attachment:plot.svg)', attachments: { "plot.svg": { "image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#5b6fb4"/></svg>' } } },
    { cell_type: "code", execution_count: 8, source: 'raise Exception("not executed")', outputs: [
      { output_type: "stream", name: "stdout", text: "Saved metric: 0.85\n" },
      { output_type: "display_data", data: { "text/html": '<table><tr><th>Saved AUC</th><td>0.85</td></tr></table><script>fetch("https://unsafe.invalid/execute");window.unsafe=1</script>' } },
      { output_type: "error", ename: "ValueError", evalue: "previous run problem", traceback: ["saved traceback"] },
      { output_type: "display_data", data: { "application/vnd.jupyter.widget-view+json": { model_id: "not-activated" } } },
    ] }, { cell_type: "code", execution_count: null, source: "# output not saved", outputs: [] },
  ] }));
  return { pack, paper, csv, notebook, report, usage };
}
