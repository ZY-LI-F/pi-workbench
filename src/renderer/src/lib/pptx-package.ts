function relationshipSourceDirectory(relationshipPath: string): string | undefined {
  if (relationshipPath === "_rels/.rels") return "";
  const marker = "/_rels/";
  const markerIndex = relationshipPath.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const ownerDirectory = relationshipPath.slice(0, markerIndex);
  const relationshipName = relationshipPath.slice(markerIndex + marker.length);
  if (!relationshipName.endsWith(".rels")) return undefined;
  const ownerPart = `${ownerDirectory}/${relationshipName.slice(0, -".rels".length)}`;
  const slash = ownerPart.lastIndexOf("/");
  return slash < 0 ? "" : ownerPart.slice(0, slash);
}

export function relativePackageTarget(fromDirectory: string, absoluteTarget: string): string {
  const from = fromDirectory.split("/").filter(Boolean);
  const target = absoluteTarget.replace(/^\/+/, "").split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) common += 1;
  return [
    ...Array.from({ length: from.length - common }, () => ".."),
    ...target.slice(common),
  ].join("/");
}

/**
 * Some OOXML producers emit valid package-root relationship targets such as
 * `/ppt/slides/slide1.xml`. The preview parser currently resolves every target
 * as relative, so normalize only those root targets before handing it the file.
 */
export async function normalizePptxRelationshipTargets(source: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(source);
  let changed = false;

  for (const relationshipPath of Object.keys(archive.files).filter((path) => path.endsWith(".rels"))) {
    const sourceDirectory = relationshipSourceDirectory(relationshipPath);
    const file = archive.file(relationshipPath);
    if (sourceDirectory === undefined || !file) continue;
    const xml = await file.async("string");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error(`PPTX 关系文件不是有效 XML: ${relationshipPath}`);
    let relationshipChanged = false;

    for (const relationship of Array.from(document.getElementsByTagNameNS("*", "Relationship"))) {
      if (relationship.getAttribute("TargetMode") === "External") continue;
      const target = relationship.getAttribute("Target");
      if (!target?.startsWith("/")) continue;
      relationship.setAttribute("Target", relativePackageTarget(sourceDirectory, target));
      relationshipChanged = true;
    }

    if (!relationshipChanged) continue;
    changed = true;
    archive.file(relationshipPath, new XMLSerializer().serializeToString(document));
  }

  if (!changed) return source;
  return archive.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
