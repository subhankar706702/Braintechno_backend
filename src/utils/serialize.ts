export function serializeDocument<T extends Record<string, any>>(doc: T): T & { id: string } {
  const raw = { ...doc } as any;
  const mongoId = raw._id ?? raw.id;
  return { ...raw, id: mongoId ? String(mongoId) : String(raw.id ?? '') };
}

export function normalizeLegacyDesign(design: unknown): unknown {
  if (Array.isArray(design) && design.length === 1 && design[0] && typeof design[0] === 'object') {
    return design[0];
  }
  return design && typeof design === 'object' ? design : {
    counters: {},
    body: {
      rows: [],
      values: {
        backgroundColor: '#ffffff',
        contentWidth: '600px',
        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' }
      }
    },
    schemaVersion: 21
  };
}
