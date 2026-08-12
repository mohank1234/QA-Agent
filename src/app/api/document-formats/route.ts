import { NextResponse } from "next/server";
import { TEMPLATES } from "@/lib/documentTemplates";

// Public: the format catalogue is static metadata, not project data, so this
// needs no project scoping or auth.
export async function GET() {
  return NextResponse.json({
    formats: TEMPLATES.map((t) => ({
      id: t.id,
      docType: t.docType,
      name: t.name,
      description: t.description,
      basedOn: t.basis,
      bestFor: t.bestFor,
      length: t.lengthGuide,
      sectionCount: t.sections.length,
      sections: t.sections,
      accent: `#${t.theme.accent}`,
    })),
  });
}
